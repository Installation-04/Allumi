import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "@/modules/banking/domain/csv";
import { keyLines, normalizeDescription } from "@/modules/banking/domain/dedupe";
import { applyCsvMapping, guessDateOrder, suggestMapping, type CsvMapping } from "@/modules/banking/domain/mapping";
import { guessDecimalSeparator, parseAmount, parseStatementDate } from "@/modules/banking/domain/money";
import { parseOfx } from "@/modules/banking/domain/ofx";
import { categorizeLines, MAX_MATCHED_LINES, matchProblem, transferLines, transferProblem } from "@/modules/banking/domain/matching";
import { readStatement } from "@/modules/banking/domain/read";
import { decodeStatement, detectFormat, MAX_STATEMENT_BYTES, StatementError } from "@/modules/banking/domain/statement";

const bytes = (text: string) => new TextEncoder().encode(text);
const codeOf = (fn: () => unknown): string => {
  try { fn(); } catch (error) { if (error instanceof StatementError) return error.code; throw error; }
  throw new Error("expected a StatementError");
};

describe("reading the bytes of a statement", () => {
  it("reads UTF-8 with or without a byte-order mark, and Windows-1252 when it is not UTF-8", () => {
    expect(decodeStatement(bytes("Épicerie"))).toBe("Épicerie");
    expect(decodeStatement(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("Date;Montant")]))).toBe("Date;Montant");
    expect(decodeStatement(new Uint8Array([0x42, 0x6f, 0x75, 0x74, 0x69, 0x71, 0x75, 0x65, 0x20, 0x4c, 0x65, 0x76, 0xe9, 0x73, 0x71, 0x75, 0x65]))).toBe("Boutique Levésque"); // é as one byte
  });
  it("refuses a file with nothing in it or more than a statement can be", () => {
    expect(codeOf(() => decodeStatement(new Uint8Array(0)))).toBe("empty");
    expect(codeOf(() => decodeStatement(new Uint8Array(MAX_STATEMENT_BYTES + 1)))).toBe("tooLarge");
    expect(decodeStatement(new Uint8Array(MAX_STATEMENT_BYTES).fill(0x20)).length).toBe(MAX_STATEMENT_BYTES);
  });
  it("tells OFX from CSV", () => {
    expect(detectFormat("OFXHEADER:100\nDATA:OFXSGML\n")).toBe("OFX");
    expect(detectFormat('<?xml version="1.0"?>\n<?OFX OFXHEADER="200"?>\n<OFX>\n')).toBe("OFX");
    expect(detectFormat("  \n<OFX>")).toBe("OFX");
    expect(detectFormat("Date,Montant\n2026-01-01,5")).toBe("CSV");
  });
});

describe("CSV", () => {
  it("splits quoted cells that hold the delimiter, quotes and line breaks", () => {
    expect(parseCsv('Date,Description,Montant\r\n2026-01-02,"Café, croissant",-4.50\r\n2026-01-03,"Dit ""bonjour""\nà deux lignes",10\r\n')).toEqual([
      ["Date", "Description", "Montant"],
      ["2026-01-02", "Café, croissant", "-4.50"],
      ["2026-01-03", 'Dit "bonjour"\nà deux lignes', "10"],
    ]);
  });
  it("detects the delimiter of the first lines, outside quotes", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t");
    expect(detectDelimiter('a,b\n"x;y;z",2\n')).toBe(",");
    expect(detectDelimiter("seule colonne\nune autre\n")).toBe(",");
    expect(parseCsv("Date;Montant;Libellé\n2026-01-02;-4,50;Café\n")[1]).toEqual(["2026-01-02", "-4,50", "Café"]);
  });
  it("drops empty rows, keeps empty cells, and reads a last row with no line break", () => {
    expect(parseCsv("a,b\n\n , \n1,\n,2")).toEqual([["a", "b"], ["1", ""], ["", "2"]]);
    expect(parseCsv("")).toEqual([]);
  });
  it("refuses what is not a statement: an open quote, a cell or a row count beyond reason", () => {
    expect(codeOf(() => parseCsv('a,"b\n1,2'))).toBe("unreadable");
    expect(codeOf(() => parseCsv(`a,${"x".repeat(1001)}\n`))).toBe("unreadable");
    expect(codeOf(() => parseCsv(Array.from({ length: 41 }, (_, i) => i).join(",")))).toBe("unreadable");
    expect(codeOf(() => parseCsv(Array.from({ length: 20_005 }, (_, i) => `2026-01-01,${i + 1}`).join("\n")))).toBe("tooLarge");
  });
});

describe("amounts in exact cents", () => {
  it("reads the notations banks use", () => {
    const cases: [string, "." | ",", bigint][] = [
      ["1234.56", ".", 123456n], ["1,234.56", ".", 123456n], ["1 234,56", ",", 123456n], ["1 234,56", ",", 123456n], ["1.234,56", ",", 123456n],
      ["-12.30", ".", -1230n], ["+7,5", ",", 750n], ["(45.00)", ".", -4500n], ["12.30-", ".", -1230n], ["−3.10", ".", -310n], ["-$12.30", ".", -1230n],
      ["$1,000", ".", 100000n], ["12.50 CAD", ".", 1250n], ["0.05", ".", 5n], ["12.500", ".", 1250n], ["7", ".", 700n], ["1'234.50", ".", 123450n],
    ];
    for (const [text, decimal, cents] of cases) expect(parseAmount(text, decimal), text).toBe(cents);
  });
  it("refuses what is not exactly an amount", () => {
    const refused: [string, "." | ","][] = [["", "."], ["abc", "."], ["12.345", "."], ["1,23", "."], ["12.30.10", "."], ["--5", "."], ["(5)-", "."], ["-(5)", "."], ["1,2345.00", "."], ["12,34", "."], ["1.5e3", "."], ["10000000000000000", "."], ["12.3.4,5", ","]];
    for (const [text, decimal] of refused) expect(parseAmount(text, decimal), text).toBeNull();
    // the same text, read with the other separator, is another amount or none
    expect(parseAmount("1,234", ".")).toBe(123400n);
    expect(parseAmount("1,234", ",")).toBeNull();
  });
  it("reads back any amount written in any of the notations (property)", () => {
    fc.assert(fc.property(fc.bigInt({ min: 1n, max: 999_999_999_999n }), fc.boolean(), fc.constantFrom(".", ","), fc.constantFrom("plain", "grouped", "currency", "paren", "trailing"), (cents, negative, decimal, style) => {
      const whole = (cents / 100n).toString();
      const fraction = (cents % 100n).toString().padStart(2, "0");
      const group = decimal === "." ? "," : " ";
      const text = style === "grouped" ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, group) : whole;
      const body = `${text}${decimal}${fraction}`;
      const written = style === "currency" ? `${negative ? "-" : ""}$${body}` : style === "paren" ? (negative ? `(${body})` : body) : style === "trailing" ? `${body}${negative ? "-" : ""}` : `${negative ? "-" : ""}${body}`;
      expect(parseAmount(written, decimal)).toBe(negative ? -cents : cents);
    }));
  });
  it("guesses the decimal separator from the figures", () => {
    expect(guessDecimalSeparator(["12,50", "3,00", "1 000,25"])).toBe(",");
    expect(guessDecimalSeparator(["12.50", "1,000.25"])).toBe(".");
    expect(guessDecimalSeparator(["100", "200"])).toBe(".");
  });
});

describe("dates", () => {
  it("reads the orders and separators statements use, and only real days", () => {
    const cases: [string, "YMD" | "DMY" | "MDY", string | null][] = [
      ["2026-10-15", "YMD", "2026-10-15"], ["2026/10/15", "YMD", "2026-10-15"], ["20261015", "YMD", "2026-10-15"], ["2026-10-15 13:45:00", "YMD", "2026-10-15"], ["2026-10-15T13:45:00Z", "YMD", "2026-10-15"],
      ["15/10/2026", "DMY", "2026-10-15"], ["15-10-2026", "DMY", "2026-10-15"], ["15.10.26", "DMY", "2026-10-15"], ["5/1/2026", "DMY", "2026-01-05"], ["15102026", "DMY", "2026-10-15"],
      ["10/15/2026", "MDY", "2026-10-15"], ["10152026", "MDY", "2026-10-15"],
      ["2026-02-30", "YMD", null], ["15/13/2026", "DMY", null], ["31/04/2026", "DMY", null], ["1/1/1899", "DMY", null], ["hier", "YMD", null], ["", "YMD", null], ["15/10", "DMY", null],
      ["10/15/2026", "DMY", null], ["2026-10-15", "DMY", null],
    ];
    for (const [text, order, iso] of cases) expect(parseStatementDate(text, order), `${text} as ${order}`).toBe(iso);
  });
  it("guesses an order that makes every sampled date possible", () => {
    expect(guessDateOrder(["2026-10-15", "2026-10-16"])).toBe("YMD");
    expect(guessDateOrder(["15/10/2026", "03/11/2026"])).toBe("DMY");
    expect(guessDateOrder(["10/15/2026", "11/03/2026"])).toBe("MDY");
    expect(guessDateOrder(["01/02/2026"])).toBe("DMY");
    expect(guessDateOrder(["20261015"])).toBe("YMD");
  });
});

const mapping = (over: Partial<CsvMapping> = {}): CsvMapping => ({
  hasHeader: true, dateColumn: 0, dateOrder: "YMD", descriptionColumns: [1], payeeColumn: null, amount: { kind: "single", column: 2 }, decimal: ".", invertSign: false, ...over,
});

describe("a CSV with a mapping", () => {
  const rows = [
    ["Date", "Description", "Montant"],
    ["2026-01-02", "  Café   Central ", "-4.50"],
    ["2026-01-03", "Virement reçu", "1,200.00"],
    ["", "", ""],
    ["2026-01-04", "Rien", "0.00"],
    ["2026-13-01", "Mauvaise date", "5"],
    ["2026-01-05", "Mauvais montant", "cinq"],
  ];
  it("reads the lines in exact cents, skips what is empty or zero, and reports each unreadable row by its line number", () => {
    const result = applyCsvMapping(rows, mapping());
    expect(result.lines).toEqual([
      { date: "2026-01-02", amountCents: -450n, description: "Café Central", payee: null, externalId: null },
      { date: "2026-01-03", amountCents: 120000n, description: "Virement reçu", payee: null, externalId: null },
    ]);
    expect(result.skipped).toBe(2);
    expect(result.errors).toEqual([{ row: 6, code: "date" }, { row: 7, code: "amount" }]);
    expect(result.errorCount).toBe(2);
  });
  it("inverts the sign for a card statement that shows a charge as a positive figure", () => {
    const [first] = applyCsvMapping(rows, mapping({ invertSign: true })).lines;
    expect(first?.amountCents).toBe(450n);
  });
  it("reads two columns, money out and money in, whatever sign each holds", () => {
    const split = mapping({ amount: { kind: "split", outColumn: 2, inColumn: 3 } });
    const result = applyCsvMapping([
      ["Date", "Description", "Retrait", "Dépôt"],
      ["2026-01-02", "Achat", "12.30", ""],
      ["2026-01-03", "Paie", "", "1000.00"],
      ["2026-01-04", "Signe dans la colonne", "-5.00", "0.00"],
      ["2026-01-05", "Les deux", "5.00", "5.00"],
      ["2026-01-06", "Aucun", "", ""],
    ], split);
    expect(result.lines.map((line) => line.amountCents)).toEqual([-1230n, 100000n, -500n]);
    expect(result.errors).toEqual([{ row: 5, code: "amount" }, { row: 6, code: "amount" }]);
  });
  it("joins up to three description columns, adds a payee, and falls back to a dash", () => {
    const result = applyCsvMapping([["2026-01-02", "ACHAT", "BOUTIQUE", "-5,00", "Boutique Lévesque"], ["2026-01-03", "", "", "-1,00", ""]], mapping({ hasHeader: false, descriptionColumns: [1, 2], payeeColumn: 4, amount: { kind: "single", column: 3 }, decimal: "," }));
    expect(result.lines.map((line) => [line.description, line.payee])).toEqual([["ACHAT BOUTIQUE", "Boutique Lévesque"], ["—", null]]);
  });
  it("keeps a description to a reasonable length, with no control characters", () => {
    const [line] = applyCsvMapping([["2026-01-02", `A\u0000B\n${"x".repeat(400)}`, "1"]], mapping({ hasHeader: false })).lines;
    expect(line?.description.length).toBe(200);
    expect(line?.description).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe("a first guess at the mapping", () => {
  it("reads a French two-column statement from its header", () => {
    const rows = parseCsv("Date;Description;Retrait;Dépôt;Solde\n15/10/2026;ACHAT BOUTIQUE;12,30;;1 000,00\n16/10/2026;PAIE;;1 500,00;2 500,00\n");
    expect(suggestMapping(rows)).toEqual({ hasHeader: true, dateColumn: 0, dateOrder: "DMY", descriptionColumns: [1], payeeColumn: null, amount: { kind: "split", outColumn: 2, inColumn: 3 }, decimal: ",", invertSign: false });
  });
  it("reads an English one-column statement from its header", () => {
    const rows = parseCsv("Transaction Date,Description,Amount\n2026-10-15,COFFEE,-4.50\n2026-10-16,REFUND,10.00\n");
    expect(suggestMapping(rows)).toEqual({ hasHeader: true, dateColumn: 0, dateOrder: "YMD", descriptionColumns: [1], payeeColumn: null, amount: { kind: "single", column: 2 }, decimal: ".", invertSign: false });
  });
  it("reads a statement with no header from the values", () => {
    const rows = parseCsv("2026-10-15,COFFEE,-4.50\n2026-10-16,REFUND,10.00\n");
    expect(suggestMapping(rows)).toMatchObject({ hasHeader: false, dateColumn: 0, descriptionColumns: [1], amount: { kind: "single", column: 2 } });
  });
  it("gives up, rather than guess, on a file that has no date", () => {
    expect(suggestMapping(parseCsv("a,b,c\nx,y,z\n"))).toBeNull();
  });
});

const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261016120000<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>CAD
<BANKACCTFROM><BANKID>00012<ACCTID>123456789012<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261015
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261002120000[-5:EST]<TRNAMT>-12.30<FITID>2026100201<NAME>CAFE CENTRAL<MEMO>Achat par carte</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005<TRNAMT>1500.00<FITID>2026100501<NAME>PAIE &amp; PRIMES</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>0.00<FITID>2026100601<NAME>Frais annulés</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261007<TRNAMT>-5,25<FITID>2026100701<NAME>VIRGULE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261008<TRNAMT>-1.00<NAME>SANS IDENTIFIANT</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1482.45<DTASOF>20261015</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
`;
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="202" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>CAD</CURDEF>
<CCACCTFROM><ACCTID>4500123412341234</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261003000000.000</DTPOSTED><TRNAMT>-89.99</TRNAMT><FITID>A1</FITID><NAME>Boutique Lévesque</NAME><MEMO>Boutique Lévesque</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261004</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>A1</FITID><NAME>Même identifiant</NAME></STMTTRN>
<STMTTRN><TRNTYPE>PAYMENT</TRNTYPE><DTPOSTED>pas une date</DTPOSTED><TRNAMT>50.00</TRNAMT><FITID>A3</FITID></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>-99.99</BALAMT><DTASOF>20261015</DTASOF></LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

describe("OFX", () => {
  it("reads an SGML statement: dates as written, amounts with either decimal mark, the bank's ids, the closing balance", () => {
    const ofx = parseOfx(SGML);
    expect(ofx).toMatchObject({ currency: "CAD", accountMask: "9012", errorCount: 1, skipped: 1, ledgerBalance: { cents: 148245n, date: "2026-10-15" } });
    expect(ofx.lines).toEqual([
      { date: "2026-10-02", amountCents: -1230n, description: "CAFE CENTRAL · Achat par carte", payee: "CAFE CENTRAL", externalId: "2026100201" },
      { date: "2026-10-05", amountCents: 150000n, description: "PAIE & PRIMES", payee: "PAIE & PRIMES", externalId: "2026100501" },
      { date: "2026-10-07", amountCents: -525n, description: "VIRGULE", payee: "VIRGULE", externalId: "2026100701" },
    ]); // the line with no id is an error, the zero is skipped
  });
  it("reads an XML credit card statement, and a repeated id keeps no id of its own", () => {
    const ofx = parseOfx(XML);
    expect(ofx).toMatchObject({ currency: "CAD", accountMask: "1234", errorCount: 1, ledgerBalance: { cents: -9999n, date: "2026-10-15" } });
    expect(ofx.lines).toEqual([
      { date: "2026-10-03", amountCents: -8999n, description: "Boutique Lévesque", payee: "Boutique Lévesque", externalId: "A1" },
      { date: "2026-10-04", amountCents: -1000n, description: "Même identifiant", payee: "Même identifiant", externalId: null },
    ]);
  });
  it("refuses a file that has no OFX in it", () => {
    expect(codeOf(() => parseOfx("Date,Montant\n"))).toBe("unreadable");
  });
});

describe("the key of a line", () => {
  it("is the bank's id for OFX, and date, amount and description with a rank for CSV", () => {
    const lines = [
      { date: "2026-01-02", amountCents: -450n, description: "Café  CENTRAL", payee: null, externalId: null },
      { date: "2026-01-02", amountCents: -450n, description: "cafe central", payee: null, externalId: null },
      { date: "2026-01-02", amountCents: -450n, description: "Autre", payee: null, externalId: null },
      { date: "2026-01-03", amountCents: 100n, description: "Dépôt", payee: null, externalId: "F1" },
    ];
    expect(keyLines(lines).map((line) => line.dedupeKey)).toEqual([
      "csv:2026-01-02|-450|cafe central|1", "csv:2026-01-02|-450|cafe central|2", "csv:2026-01-02|-450|autre|1", "ofx:F1",
    ]);
    expect(normalizeDescription("  ÉPICERIE   Métro\t")).toBe("epicerie metro");
  });
  it("gives the same line the same key in a later statement that overlaps this one", () => {
    const a = keyLines([{ date: "2026-01-02", amountCents: -450n, description: "Café", payee: null, externalId: null }, { date: "2026-01-02", amountCents: -450n, description: "Café", payee: null, externalId: null }]);
    const b = keyLines([{ date: "2026-01-02", amountCents: -450n, description: "Café", payee: null, externalId: null }, { date: "2026-01-02", amountCents: -450n, description: "Café", payee: null, externalId: null }, { date: "2026-01-02", amountCents: -450n, description: "Café", payee: null, externalId: null }]);
    expect(b.slice(0, 2).map((line) => line.dedupeKey)).toEqual(a.map((line) => line.dedupeKey));
    expect(new Set(b.map((line) => line.dedupeKey)).size).toBe(3);
  });
});

describe("a whole statement", () => {
  it("reads a CSV with the mapping it suggests, or the one it is given", () => {
    const text = "Date;Description;Retrait;Dépôt\n15/10/2026;ACHAT;12,30;\n16/10/2026;PAIE;;1 500,00\n";
    const suggested = readStatement(text);
    expect(suggested.format).toBe("CSV");
    expect(suggested.lines.map((line) => [line.date, line.amountCents])).toEqual([["2026-10-15", -1230n], ["2026-10-16", 150000n]]);
    const given = readStatement(text, { mapping: { ...suggested.mapping, invertSign: true } });
    expect(given.lines.map((line) => line.amountCents)).toEqual([1230n, -150000n]);
  });
  it("hands the table back, with no lines, when there is no mapping to suggest", () => {
    const result = readStatement("a,b,c\nx,y,z\n");
    expect(result).toMatchObject({ format: "CSV", lines: [], mapping: null });
    expect(result.table).toEqual([["a", "b", "c"], ["x", "y", "z"]]);
  });
  it("refuses a mapping that is not one, an empty file and an OFX with nothing in it", () => {
    expect(codeOf(() => readStatement("a,b\n1,2\n", { mapping: { hasHeader: true } }))).toBe("mapping");
    expect(codeOf(() => readStatement("a,b\n1,2\n", { mapping: { ...mapping(), dateColumn: 99 } }))).toBe("mapping");
    expect(codeOf(() => readStatement("  \n\n"))).toBe("empty");
    expect(codeOf(() => readStatement("<OFX><BANKTRANLIST></BANKTRANLIST></OFX>"))).toBe("noTransactions");
  });
  it("reads an OFX file whatever its mapping", () => {
    const result = readStatement(SGML, { mapping: { hasHeader: true } });
    expect(result).toMatchObject({ format: "OFX", currency: "CAD", accountMask: "9012", table: null, mapping: null });
    expect(result.lines.map((line) => line.dedupeKey)).toEqual(["ofx:2026100201", "ofx:2026100501", "ofx:2026100701"]);
  });
});

describe("matching a statement line to ledger lines", () => {
  const lines = (...cents: bigint[]) => cents.map((value, i) => ({ id: `l${i}`, cents: value }));
  it("accepts lines that together are exactly the amount, whatever their signs", () => {
    expect(matchProblem(10_000n, lines(10_000n))).toBeNull();
    expect(matchProblem(14_700n, lines(15_000n, -300n))).toBeNull();
    expect(matchProblem(-4_599n, lines(-4_000n, -599n))).toBeNull();
  });
  it("refuses none, too many, one twice, and a sum that is off by a cent", () => {
    expect(matchProblem(100n, [])).toBe("empty");
    expect(matchProblem(BigInt(MAX_MATCHED_LINES + 1), Array.from({ length: MAX_MATCHED_LINES + 1 }, (_, i) => ({ id: `l${i}`, cents: 1n })))).toBe("tooMany");
    expect(matchProblem(BigInt(MAX_MATCHED_LINES), Array.from({ length: MAX_MATCHED_LINES }, (_, i) => ({ id: `l${i}`, cents: 1n })))).toBeNull();
    expect(matchProblem(200n, [{ id: "a", cents: 100n }, { id: "a", cents: 100n }])).toBe("duplicate");
    expect(matchProblem(10_000n, lines(9_999n))).toBe("sum");
    expect(matchProblem(10_000n, lines(10_001n))).toBe("sum");
    expect(matchProblem(10_000n, lines(-10_000n))).toBe("sum");
  });
  it("adds beyond the safe range of a float without losing a cent", () => {
    const big = 90_071_992_547_409_930n;
    expect(matchProblem(big + 1n, lines(big, 1n))).toBeNull();
    expect(matchProblem(big + 2n, lines(big, 1n))).toBe("sum");
  });
});

describe("the entry that records a statement line", () => {
  const total = (entry: { debitCents: bigint; creditCents: bigint }[]) => [entry.reduce((sum, l) => sum + l.debitCents, 0n), entry.reduce((sum, l) => sum + l.creditCents, 0n)];
  it("debits the statement's account for money in and credits it for money out, and always balances", () => {
    expect(categorizeLines(2_500n, "bank", "sales", "Dépôt")).toEqual([
      { accountId: "bank", debitCents: 2_500n, creditCents: 0n, description: "Dépôt" },
      { accountId: "sales", debitCents: 0n, creditCents: 2_500n, description: "Dépôt" },
    ]);
    expect(categorizeLines(-4_599n, "bank", "expenses", null)).toEqual([
      { accountId: "bank", debitCents: 0n, creditCents: 4_599n, description: null },
      { accountId: "expenses", debitCents: 4_599n, creditCents: 0n, description: null },
    ]);
    fc.assert(fc.property(fc.bigInt({ min: -99_999_999_999n, max: 99_999_999_999n }).filter((n) => n !== 0n), (amount) => {
      const [debit, credit] = total(categorizeLines(amount, "a", "b", null));
      expect(debit).toBe(credit);
      expect(debit).toBe(amount < 0n ? -amount : amount);
    }));
  });
  it("is a transfer only between two accounts, for exactly opposite amounts", () => {
    const out = { accountId: "chequing", amountCents: -50_000n };
    const into = { accountId: "card", amountCents: 50_000n };
    expect(transferProblem(out, into)).toBeNull();
    expect(transferProblem(into, out)).toBeNull();
    expect(transferProblem(out, { ...into, accountId: "chequing" })).toBe("sameAccount");
    expect(transferProblem(out, { ...into, amountCents: 50_001n })).toBe("amounts");
    expect(transferProblem(out, { ...into, amountCents: -50_000n })).toBe("amounts");
    expect(transferProblem({ accountId: "a", amountCents: 0n }, { accountId: "b", amountCents: 0n })).toBe("amounts");
  });
  it("puts one line on each account: a debit where money came in, a credit where it went out", () => {
    const out = { accountId: "chequing", amountCents: -50_000n };
    const into = { accountId: "card", amountCents: 50_000n };
    expect(transferLines(out, into, "Paiement")).toEqual([
      { accountId: "chequing", debitCents: 0n, creditCents: 50_000n, description: "Paiement" },
      { accountId: "card", debitCents: 50_000n, creditCents: 0n, description: "Paiement" },
    ]);
    const [debit, credit] = total(transferLines(into, out, null));
    expect(debit).toBe(credit);
  });
});
