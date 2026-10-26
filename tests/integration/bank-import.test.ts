import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSavedMapping, importStatement, listBankAccounts, listBankTransactions, listImports, setTransactionStatus, TRANSACTIONS_PER_PAGE } from "@/modules/banking";
import { AppError } from "@/platform/errors";
import type { CompanyContext } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";

const actor: CompanyContext = { userId: W.userOwnerA, companyId: W.companyA };
const accountant: CompanyContext = { ...actor, userId: W.userAccountant };
const reader: CompanyContext = { ...actor, userId: W.userReader };
const otherOwner: CompanyContext = { userId: W.userOwnerB, companyId: W.companyB };

let db: pg.Client;
let accountCounter = 0;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
});
afterAll(async () => { await db?.end(); });

const bytes = (text: string) => new TextEncoder().encode(text);
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
async function refusal(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { if (error instanceof AppError) return error.key; throw error; }
  throw new Error("expected a refusal");
}
const count = async (sql: string, args: unknown[] = []) => (await db.query(`SELECT count(*)::int AS n FROM ${sql}`, args)).rows[0].n as number;

/** A statement account of its own for each test, so lines and keys never meet another test's. */
async function account(subtype = "BANK", over: { active?: boolean; company?: string } = {}): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO account (id, company_id, code, name_fr, name_en, type, subtype, is_active, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7::account_subtype, $8, now())", [
    id, over.company ?? W.companyA, `16${String(++accountCounter).padStart(2, "0")}`, `Compte ${accountCounter}`, `Account ${accountCounter}`, subtype === "CREDIT_CARD" ? "LIABILITY" : "ASSET", subtype, over.active ?? true,
  ]);
  return id;
}
const csv = (...rows: string[]) => ["Date,Description,Montant", ...rows].join("\n") + "\n";
const load = (name: string, text: string, accountId: string, who: CompanyContext = actor, mapping?: unknown) => importStatement(who, { accountId, fileName: name, bytes: bytes(text), mapping });
const rows = async (accountId: string) => (await db.query("SELECT txn_date::text AS d, amount_cents::text AS cents, description, payee, external_id, dedupe_key, status, currency, import_id FROM bank_transaction WHERE account_id = $1 ORDER BY txn_date, dedupe_key", [accountId])).rows;

const OFX = (currency: string, ...transactions: string[]) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>${currency}
<BANKACCTFROM><BANKID>1<ACCTID>00123456789<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
${transactions.join("\n")}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>100.00<DTASOF>20261015</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
`;
const txn = (id: string, date: string, amount: string, name: string) => `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${date}<TRNAMT>${amount}<FITID>${id}<NAME>${name}</STMTTRN>`;

describe("importing a CSV statement", () => {
  it("stores each line in exact cents with a key of its own, and keeps what it learned for the next time", async () => {
    const id = await account();
    const text = csv("2026-10-02,Café Central,-4.50", "2026-10-05,Virement reçu,\"1,200.00\"", "2026-10-06,Zéro,0.00");
    const result = await load("C:\\Users\\moi\\releve octobre.csv", text, id);
    expect(result).toMatchObject({ read: 2, imported: 2, duplicates: 0, skipped: 1, firstDate: "2026-10-02", lastDate: "2026-10-05" });

    const stored = await rows(id);
    expect(stored).toEqual([
      expect.objectContaining({ d: "2026-10-02", cents: "-450", description: "Café Central", payee: null, external_id: null, dedupe_key: "csv:2026-10-02|-450|cafe central|1", status: "UNMATCHED", currency: "CAD", import_id: result.importId }),
      expect.objectContaining({ d: "2026-10-05", cents: "120000", description: "Virement reçu", dedupe_key: "csv:2026-10-05|120000|virement recu|1", status: "UNMATCHED" }),
    ]);
    const file = (await db.query("SELECT * FROM bank_import WHERE id = $1", [result.importId])).rows[0];
    expect(file).toMatchObject({ company_id: W.companyA, account_id: id, format: "CSV", file_name: "releve octobre.csv", file_sha256: sha(bytes(text)), row_count: 2, imported_by_id: W.userOwnerA });

    // the columns are kept for this account, ready for the next import
    const saved = await getSavedMapping(actor, id);
    expect(saved).toMatchObject({ hasHeader: true, dateColumn: 0, dateOrder: "YMD", descriptionColumns: [1], amount: { kind: "single", column: 2 }, decimal: "." });
    expect(await listImports(reader, id)).toEqual([expect.objectContaining({ id: result.importId, accountId: id, fileName: "releve octobre.csv", format: "CSV", rowCount: 2 })]);
  });

  it("reads a French statement with two columns and a decimal comma, with the mapping it is given", async () => {
    const id = await account();
    const text = "Date;Libellé;Retrait;Dépôt\n15/10/2026;ACHAT;12,30;\n16/10/2026;PAIE;;1 500,00\n";
    const result = await load("desjardins.csv", text, id);
    expect(result.imported).toBe(2);
    expect((await rows(id)).map((r) => [r.d, r.cents])).toEqual([["2026-10-15", "-1230"], ["2026-10-16", "150000"]]);
    // a card statement that shows a charge as a positive figure: the person flips the sign
    const card = await account("CREDIT_CARD");
    const mapping = { hasHeader: true, dateColumn: 0, dateOrder: "YMD", descriptionColumns: [1], payeeColumn: null, amount: { kind: "single", column: 2 }, decimal: ".", invertSign: true };
    await load("carte.csv", csv("2026-10-02,Restaurant,45.00", "2026-10-03,Paiement,-100.00"), card, actor, mapping);
    expect((await rows(card)).map((r) => r.cents)).toEqual(["-4500", "10000"]);
  });

  it("imports a statement in Windows-1252 and one with a byte-order mark", async () => {
    const id = await account();
    const latin1 = new Uint8Array([...bytes("Date,Description,Montant\n2026-10-02,Boutique Lev"), 0xe9, ...bytes("sque,-9.99\n")]);
    await importStatement(actor, { accountId: id, fileName: "latin1.csv", bytes: latin1 });
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(csv("2026-10-03,Épicerie,-20.00"))]);
    await importStatement(actor, { accountId: id, fileName: "bom.csv", bytes: withBom });
    expect((await rows(id)).map((r) => r.description)).toEqual(["Boutique Levésque", "Épicerie"]);
  });

  it("stores long statements, in more than one chunk", async () => {
    const id = await account();
    const many = Array.from({ length: 1200 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, "0")},Ligne ${i},-${i + 1}.00`);
    const result = await load("long.csv", csv(...many), id);
    expect(result).toMatchObject({ read: 1200, imported: 1200, duplicates: 0 });
    expect(await count("bank_transaction WHERE account_id = $1", [id])).toBe(1200);
  });
});

describe("importing an OFX statement", () => {
  it("keeps the bank's id, the signs as written, and the last four digits of the account", async () => {
    const id = await account();
    const text = OFX("CAD", txn("F1", "20261002120000[-5:EST]", "-12.30", "CAFE &amp; CIE"), txn("F2", "20261005", "1500.00", "PAIE"));
    const result = await load("releve.ofx", text, id);
    expect(result).toMatchObject({ read: 2, imported: 2, duplicates: 0 });
    expect(await rows(id)).toEqual([
      expect.objectContaining({ d: "2026-10-02", cents: "-1230", description: "CAFE & CIE", payee: "CAFE & CIE", external_id: "F1", dedupe_key: "ofx:F1" }),
      expect.objectContaining({ d: "2026-10-05", cents: "150000", external_id: "F2", dedupe_key: "ofx:F2" }),
    ]);
    expect((await db.query("SELECT format FROM bank_import WHERE id = $1", [result.importId])).rows[0].format).toBe("OFX");
    expect((await db.query("SELECT account_mask FROM bank_account_profile WHERE account_id = $1", [id])).rows[0].account_mask).toBe("6789");
  });

  it("refuses another currency than the books'", async () => {
    const id = await account();
    expect(await refusal(load("usd.ofx", OFX("USD", txn("U1", "20261002", "-5.00", "X")), id))).toBe("banking.currency");
    expect(await count("bank_import WHERE account_id = $1", [id])).toBe(0);
  });
});

describe("importing statements that overlap", () => {
  it("leaves the lines already on file as they were, and stores only the new ones", async () => {
    const id = await account();
    await load("sept.csv", csv("2026-09-28,A,-1.00", "2026-09-29,B,-2.00", "2026-09-30,C,-3.00"), id);
    const second = await load("sept-oct.csv", csv("2026-09-29,B,-2.00", "2026-09-30,C,-3.00", "2026-10-01,D,-4.00", "2026-10-02,E,-5.00"), id);
    expect(second).toMatchObject({ read: 4, imported: 2, duplicates: 2 });
    expect(await count("bank_transaction WHERE account_id = $1", [id])).toBe(5);
    expect((await db.query("SELECT row_count FROM bank_import WHERE id = $1", [second.importId])).rows[0].row_count).toBe(2);
  });

  it("counts two identical lines of one day as two, and only the third of a later statement as new", async () => {
    const id = await account();
    await load("a.csv", csv("2026-10-02,Café,-4.50", "2026-10-02,Café,-4.50"), id);
    expect(await count("bank_transaction WHERE account_id = $1", [id])).toBe(2);
    const later = await load("b.csv", csv("2026-10-02,Café,-4.50", "2026-10-02,Café,-4.50", "2026-10-02,Café,-4.50"), id);
    expect(later).toMatchObject({ imported: 1, duplicates: 2 });
    expect(await count("bank_transaction WHERE account_id = $1", [id])).toBe(3);
  });

  it("recognises an OFX line by the bank's id, whatever else changed", async () => {
    const id = await account();
    await load("a.ofx", OFX("CAD", txn("K1", "20261002", "-5.00", "Avant")), id);
    const again = await load("b.ofx", OFX("CAD", txn("K1", "20261003", "-5.00", "Après"), txn("K2", "20261004", "-6.00", "Autre")), id);
    expect(again).toMatchObject({ imported: 1, duplicates: 1 });
    expect((await rows(id)).map((r) => r.description)).toEqual(["Avant", "Autre"]);
  });

  it("refuses the same file twice on an account, and takes it on another account", async () => {
    const id = await account();
    const other = await account();
    const text = csv("2026-10-02,Café,-4.50");
    await load("a.csv", text, id);
    expect(await refusal(load("renamed.csv", text, id))).toBe("banking.alreadyImported");
    expect(await load("a.csv", text, other)).toMatchObject({ imported: 1 });
    expect(await count("bank_import WHERE account_id = $1", [id])).toBe(1);
  });

  it("never stores a line twice when several overlapping imports run at the same time", async () => {
    const id = await account();
    const common = Array.from({ length: 30 }, (_, i) => `2026-10-${String((i % 28) + 1).padStart(2, "0")},Commun ${i},-${i + 1}.00`);
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, n) => load(`parallele-${n}.csv`, csv(...common, `2026-11-01,Seulement ${n},-${100 + n}.00`), id).catch((error: unknown) => error)),
    );
    expect(attempts.filter((attempt) => attempt instanceof Error)).toEqual([]); // nobody trips over another's lines
    expect(await count("bank_transaction WHERE account_id = $1", [id])).toBe(30 + 8);
    expect((attempts as { imported: number }[]).reduce((sum, attempt) => sum + attempt.imported, 0)).toBe(38);
  });

  it("refuses the same file sent twice at once, once", async () => {
    const id = await account();
    const text = csv("2026-10-01,Une,-1.00", "2026-10-02,Deux,-2.00");
    const attempts = await Promise.all([load("x.csv", text, id).catch((error: unknown) => error), load("x.csv", text, id).catch((error: unknown) => error)]);
    const failures = attempts.filter((attempt): attempt is AppError => attempt instanceof AppError);
    expect(failures.map((failure) => failure.key)).toEqual(["banking.alreadyImported"]);
    expect(await count("bank_transaction WHERE account_id = $1", [id])).toBe(2);
  });
});

describe("what an import refuses, leaving nothing behind", () => {
  it("refuses a file that is empty, too large, unreadable or has nothing to import", async () => {
    const id = await account();
    const cases: [string, Uint8Array, string][] = [
      ["empty", new Uint8Array(0), "banking.empty"],
      ["too large", new Uint8Array(4 * 1024 * 1024 + 1), "banking.tooLarge"],
      ["blank", bytes("  \n\n"), "banking.empty"],
      ["an open quote", bytes('Date,Description,Montant\n2026-10-02,"Café,-4.50\n'), "banking.unreadable"],
      ["no columns it can read", bytes("a,b,c\nx,y,z\n"), "banking.mapping"],
      ["only zeros", bytes(csv("2026-10-02,Rien,0.00")), "banking.noTransactions"],
      ["an OFX with nothing in it", bytes("OFXHEADER:100\n<OFX><BANKTRANLIST></BANKTRANLIST></OFX>"), "banking.noTransactions"],
      ["a row that cannot be read", bytes(csv("2026-10-02,Bien,-4.50", "2026-13-45,Mauvaise date,-1.00", "2026-10-03,Montant,beaucoup")), "banking.unreadableRows"],
    ];
    for (const [label, data, key] of cases) expect(await refusal(importStatement(actor, { accountId: id, fileName: "x.csv", bytes: data })), label).toBe(key);
    expect(await refusal(load("x.csv", csv("2026-10-02,Bien,-4.50"), id, actor, { hasHeader: true }))).toBe("banking.mapping");
    expect(await refusal(load("x.csv", csv("2026-10-02,Bien,-4.50"), id, actor, { hasHeader: true, dateColumn: 99, dateOrder: "YMD", descriptionColumns: [1], payeeColumn: null, amount: { kind: "single", column: 2 }, decimal: ".", invertSign: false }))).toBe("banking.mapping");
    expect(await count("bank_import WHERE account_id = $1", [id])).toBe(0);
    expect(await count("bank_transaction WHERE account_id = $1", [id])).toBe(0);
    expect(await count("bank_account_profile WHERE account_id = $1", [id])).toBe(0);
  });

  it("refuses an account that cannot hold a statement: revenue, receivables, another company's, inactive, unknown", async () => {
    const text = csv("2026-10-02,Café,-4.50");
    const inactive = await account("BANK", { active: false });
    const foreign = await account("BANK", { company: W.companyB });
    for (const [label, accountId] of [["revenue", W.sales], ["receivables", W.receivable], ["another company's", foreign], ["inactive", inactive], ["unknown", randomUUID()]] as const) {
      expect(await refusal(load("x.csv", text, accountId)), label).toBe("banking.account");
    }
    expect(await refusal(importStatement(actor, { accountId: "pas-un-id", fileName: "x.csv", bytes: bytes(text) }))).toBe("banking.invalid");
    expect(await count("bank_import WHERE account_id IN ($1, $2, $3)", [W.sales, inactive, foreign])).toBe(0);
  });

  it("is for owners and accountants of the company", async () => {
    const id = await account();
    expect(await refusal(load("r.csv", csv("2026-10-02,A,-1.00"), id, reader))).toBe("forbidden");
    expect(await refusal(load("o.csv", csv("2026-10-02,A,-1.00"), id, otherOwner))).toBe("banking.account"); // another company's owner does not see this account
    expect(await load("acc.csv", csv("2026-10-02,A,-1.00"), id, accountant)).toMatchObject({ imported: 1 });
    expect(await count("bank_import WHERE account_id = $1", [id])).toBe(1);
  });

  it("records the import and its lines in the audit trail", async () => {
    const id = await account();
    const result = await load("audit.csv", csv("2026-10-02,A,-1.00"), id);
    const trail = (await db.query("SELECT action, entity_type, actor_user_id FROM audit_log WHERE entity_id = $1", [result.importId])).rows;
    expect(trail).toEqual([{ action: "row.insert", entity_type: "bank_import", actor_user_id: W.userOwnerA }]);
    expect(await count("audit_log WHERE entity_type = 'bank_transaction' AND after->>'account_id' = $1", [id])).toBe(1);
  });
});

describe("listing the statement lines", () => {
  it("lists lines from files and from services, newest first, with their source, and filters by account, status and text", async () => {
    const id = await account();
    const other = await account("CREDIT_CARD");
    await load("a.csv", csv("2026-10-02,Café Central,-4.50", "2026-10-03,Loyer,-1000.00"), id);
    await load("b.csv", csv("2026-10-04,Restaurant Beauregard,-30.00"), other, actor, { hasHeader: true, dateColumn: 0, dateOrder: "YMD", descriptionColumns: [1], payeeColumn: null, amount: { kind: "single", column: 2 }, decimal: ".", invertSign: false });
    // a line from an outside service, as the integrations import stores it
    const connection = randomUUID();
    await db.query("INSERT INTO integration_connection (id, company_id, provider, label, account_id, import_from, created_by_id, updated_at) VALUES ($1, $2, 'STRIPE', 'Stripe boutique', $3, '2026-01-01', $4, now())", [connection, W.companyA, id, W.userOwnerA]);
    await db.query(
      `INSERT INTO bank_transaction (id, company_id, account_id, txn_date, amount_cents, description, external_id, dedupe_key, connection_id, currency, source_type, gross_cents, fee_cents, provider_details, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '2026-10-05', 9680, 'Facture F-00002', 'stripe:txn_9', 'stripe:txn_9', $3, 'CAD', 'charge', 10000, 320, '{"kind":"PAYMENT","reference":"F-00002"}'::jsonb, now())`, [W.companyA, id, connection]);

    const all = await listBankTransactions(reader, { accountId: id });
    expect(all.total).toBe(3);
    expect(all.transactions.map((t) => [t.date, t.description])).toEqual([["2026-10-05", "Facture F-00002"], ["2026-10-03", "Loyer"], ["2026-10-02", "Café Central"]]);
    expect(all.transactions[0]).toMatchObject({ amountCents: 9680n, accountId: id, source: { kind: "service", provider: "STRIPE", label: "Stripe boutique", grossCents: 10000n, feeCents: 320n, reference: "F-00002", type: "PAYMENT", flagged: false } });
    expect(all.transactions[1]?.source).toEqual({ kind: "file", fileName: "a.csv" });
    expect((await listBankTransactions(reader, { accountId: other })).transactions).toHaveLength(1);
    expect((await listBankTransactions(reader, { accountId: id, q: "  loyer " })).transactions.map((t) => t.description)).toEqual(["Loyer"]);
    expect((await listBankTransactions(reader, { accountId: id, q: "%" })).total).toBe(0); // a search is text, not a pattern
    expect((await listBankTransactions(reader, { accountId: "pas-un-id" })).total).toBeGreaterThanOrEqual(3); // an invalid filter is ignored, not an error
    expect((await listBankTransactions(reader, { accountId: id, status: "MATCHED" })).total).toBe(0);
    expect((await listBankTransactions(otherOwner, { accountId: id })).total).toBe(0);
    expect(await refusal(listBankTransactions({ ...actor, userId: randomUUID() }, {}))).toBe("forbidden");
  });

  it("pages through a long list", async () => {
    const id = await account();
    const many = Array.from({ length: TRANSACTIONS_PER_PAGE + 5 }, (_, i) => `2026-02-${String((i % 27) + 1).padStart(2, "0")},Ligne ${i},-${i + 1}.00`);
    await load("pages.csv", csv(...many), id);
    const first = await listBankTransactions(reader, { accountId: id, page: 1 });
    const last = await listBankTransactions(reader, { accountId: id, page: 99 });
    expect(first).toMatchObject({ total: TRANSACTIONS_PER_PAGE + 5, page: 1, pageCount: 2 });
    expect(first.transactions).toHaveLength(TRANSACTIONS_PER_PAGE);
    expect(last).toMatchObject({ page: 2, pageCount: 2 });
    expect(last.transactions).toHaveLength(5);
    expect(new Set([...first.transactions, ...last.transactions].map((t) => t.id)).size).toBe(TRANSACTIONS_PER_PAGE + 5);
  });

  it("lists the accounts that hold statement lines with how many wait for a match", async () => {
    const id = await account();
    await load("count.csv", csv("2026-10-02,A,-1.00", "2026-10-03,B,-2.00"), id);
    const accounts = await listBankAccounts(reader);
    expect(accounts.find((a) => a.id === id)).toMatchObject({ unmatchedCount: 2, subtype: "BANK" });
    expect(accounts.map((a) => a.id)).not.toContain(W.sales);
    expect(accounts.map((a) => a.id)).not.toContain(W.receivable);
  });

  it("sets a line aside and brings it back, and leaves a matched line alone", async () => {
    const id = await account();
    await load("aside.csv", csv("2026-10-02,A,-1.00", "2026-10-03,B,-2.00"), id);
    const [first, second] = (await listBankTransactions(actor, { accountId: id })).transactions;
    await setTransactionStatus(accountant, first!.id, "EXCLUDED");
    expect((await listBankTransactions(actor, { accountId: id, status: "EXCLUDED" })).transactions.map((t) => t.id)).toEqual([first!.id]);
    await setTransactionStatus(actor, first!.id, "UNMATCHED");
    expect((await listBankTransactions(actor, { accountId: id, status: "EXCLUDED" })).total).toBe(0);
    await db.query("UPDATE bank_transaction SET status = 'EXCLUDED' WHERE id = $1", [second!.id]);
    await db.query("UPDATE bank_transaction SET status = 'UNMATCHED' WHERE id = $1", [second!.id]);
    expect(await refusal(setTransactionStatus(reader, first!.id, "EXCLUDED"))).toBe("forbidden");
    expect(await refusal(setTransactionStatus(otherOwner, first!.id, "EXCLUDED"))).toBe("banking.transactionNotFound");
    expect(await refusal(setTransactionStatus(actor, randomUUID(), "EXCLUDED"))).toBe("banking.transactionNotFound");
  });
});
