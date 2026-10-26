import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AGE_BUCKETS, ageBucket, agingCsv, buildAging, daysPastDue, type AgeBucket, type AgingItem, type AgingLabels } from "@/modules/reports";

const item = (over: Partial<AgingItem> & Pick<AgingItem, "id" | "cents">): AgingItem => ({
  kind: "INVOICE", contactId: "c1", contactName: "Client Un", number: null, date: "2026-06-01", dueDate: "2026-07-01", ...over,
});

describe("days past due", () => {
  it("counts whole days from the due date, across month, leap-day and year ends", () => {
    expect(daysPastDue("2026-07-01", "2026-07-01")).toBe(0);
    expect(daysPastDue("2026-07-01", "2026-07-02")).toBe(1);
    expect(daysPastDue("2026-07-01", "2026-06-30")).toBe(-1);
    expect(daysPastDue("2028-02-28", "2028-03-01")).toBe(2); // a leap year
    expect(daysPastDue("2027-02-28", "2027-03-01")).toBe(1);
    expect(daysPastDue("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysPastDue("2026-01-01", "2027-01-01")).toBe(365);
  });
});

describe("the age buckets", () => {
  it("puts a day on the right side of every boundary", () => {
    const at = (days: number): AgeBucket => ageBucket(days);
    expect([at(-400), at(-1), at(0)]).toEqual(["current", "current", "current"]);
    expect([at(1), at(30)]).toEqual(["d1_30", "d1_30"]);
    expect([at(31), at(60)]).toEqual(["d31_60", "d31_60"]);
    expect([at(61), at(90)]).toEqual(["d61_90", "d61_90"]);
    expect([at(91), at(5000)]).toEqual(["d91_plus", "d91_plus"]);
  });
});

describe("building the aging", () => {
  const asOf = "2026-10-31";
  const items: AgingItem[] = [
    item({ id: "i1", cents: 10_000n, number: "F-00001", date: "2026-10-01", dueDate: "2026-11-15" }), // not due
    item({ id: "i2", cents: 20_000n, number: "F-00002", date: "2026-09-01", dueDate: "2026-10-01" }), // 30 days
    item({ id: "i3", cents: 30_000n, number: "F-00003", date: "2026-08-01", dueDate: "2026-09-01" }), // 60 days
    item({ id: "i4", cents: 40_000n, number: "F-00004", date: "2026-07-01", dueDate: "2026-08-01" }), // 91 days
    item({ id: "i5", cents: 5_000n, number: "F-00005", date: "2026-09-30", dueDate: null }), // no due date: its own date, 31 days
    item({ id: "p1", kind: "PAYMENT", cents: -7_000n, number: "E-00001", date: "2026-10-20", dueDate: null }),
    item({ id: "n1", kind: "CREDIT_NOTE", cents: -1_500n, number: "AV-00001", date: "2026-10-21", dueDate: null }),
    item({ id: "j1", contactId: "c2", contactName: "Alma inc.", cents: 99n, number: "F-00006", date: "2026-10-31", dueDate: "2026-10-31" }), // due today
  ];
  const aging = buildAging(items, asOf);

  it("ages each open invoice by its due date, or by its own date when it has none", () => {
    const first = aging.customers.find((customer) => customer.contactId === "c1")!;
    expect(first.buckets).toEqual({ current: 10_000n, d1_30: 20_000n, d31_60: 35_000n, d61_90: 0n, d91_plus: 40_000n });
    expect(first.items.filter((entry) => entry.kind === "INVOICE").map((entry) => [entry.id, entry.daysPastDue, entry.bucket])).toEqual([
      ["i4", 91, "d91_plus"], ["i3", 60, "d31_60"], ["i5", 31, "d31_60"], ["i2", 30, "d1_30"], ["i1", -15, "current"],
    ]);
  });

  it("keeps credits and payments not yet applied apart, unaged, and negative", () => {
    const first = aging.customers.find((customer) => customer.contactId === "c1")!;
    expect(first.unappliedCents).toBe(-8_500n);
    expect(first.items.filter((entry) => entry.kind !== "INVOICE").map((entry) => [entry.id, entry.daysPastDue, entry.bucket])).toEqual([["n1", null, null], ["p1", null, null]]);
    expect(first.totalCents).toBe(105_000n - 8_500n);
  });

  it("lists customers by name and adds up every column exactly", () => {
    expect(aging.customers.map((customer) => customer.contactName)).toEqual(["Alma inc.", "Client Un"]);
    expect(aging.buckets).toEqual({ current: 10_099n, d1_30: 20_000n, d31_60: 35_000n, d61_90: 0n, d91_plus: 40_000n });
    expect(aging.unappliedCents).toBe(-8_500n);
    expect(aging.totalCents).toBe(96_599n);
  });

  it("is the same whatever the order the items come in, and when nothing is open", () => {
    expect(buildAging([...items].reverse(), asOf)).toEqual(aging);
    expect(buildAging([], asOf)).toEqual({ customers: [], buckets: { current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d91_plus: 0n }, unappliedCents: 0n, totalCents: 0n });
  });

  it("keeps a customer whose invoice and unapplied payment cancel out, at zero", () => {
    const zero = buildAging([item({ id: "a", cents: 5_000n }), item({ id: "b", kind: "PAYMENT", cents: -5_000n, dueDate: null })], asOf);
    expect(zero.customers).toHaveLength(1);
    expect(zero.customers[0]?.totalCents).toBe(0n);
  });

  it("separates two customers who share a name, by identifier", () => {
    const twins = buildAging([item({ id: "a", contactId: "x2", contactName: "Même nom", cents: 1n }), item({ id: "b", contactId: "x1", contactName: "Même nom", cents: 2n })], asOf);
    expect(twins.customers.map((customer) => customer.contactId)).toEqual(["x1", "x2"]);
  });

  it("is exact beyond the safe integers of floating point", () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    const big = buildAging([item({ id: "a", cents: huge }), item({ id: "b", cents: 1n })], asOf);
    expect(big.totalCents).toBe(huge + 1n);
    expect(big.buckets.d31_60 + big.buckets.d1_30 + big.buckets.d61_90 + big.buckets.d91_plus + big.buckets.current).toBe(huge + 1n);
  });

  it("adds up, whatever the items: the buckets and the unapplied make the total, per customer and in all", () => {
    const kind = fc.constantFrom<AgingItem["kind"]>("INVOICE", "CREDIT_NOTE", "PAYMENT", "REFUND");
    const day = fc.integer({ min: 0, max: 600 }).map((offset) => new Date(Date.UTC(2025, 0, 1 + offset)).toISOString().slice(0, 10));
    const one = fc.record({ kind, contact: fc.integer({ min: 0, max: 3 }), cents: fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }), date: day, due: fc.option(day, { nil: null }) });
    fc.assert(fc.property(fc.array(one, { maxLength: 40 }), (rows) => {
      const built = buildAging(rows.map((row, index) => item({ id: `r${index}`, kind: row.kind, contactId: `c${row.contact}`, contactName: `Client ${row.contact}`, cents: row.cents, date: row.date, dueDate: row.due })), "2026-10-31");
      const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);
      for (const customer of built.customers) {
        expect(sum(AGE_BUCKETS.map((bucket) => customer.buckets[bucket])) + customer.unappliedCents).toBe(customer.totalCents);
        expect(sum(customer.items.map((entry) => entry.cents))).toBe(customer.totalCents);
      }
      expect(sum(AGE_BUCKETS.map((bucket) => built.buckets[bucket])) + built.unappliedCents).toBe(built.totalCents);
      expect(sum(rows.map((row) => row.cents))).toBe(built.totalCents);
    }));
  });
});

describe("the aging file", () => {
  const labels: AgingLabels = {
    customer: "Client", document: "Pièce", number: "Numéro", date: "Date", dueDate: "Échéance", daysPastDue: "Jours de retard",
    current: "Courant", d1_30: "1–30 jours", d31_60: "31–60 jours", d61_90: "61–90 jours", d91_plus: "91 jours et plus", unapplied: "Non appliqué", total: "Total",
    kinds: { INVOICE: "Facture", CREDIT_NOTE: "Avoir", PAYMENT: "Encaissement", REFUND: "Remboursement" }, totalLine: "Total",
  };
  const aging = buildAging([
    item({ id: "i1", cents: 123_456n, number: "F-00001", date: "2026-09-01", dueDate: "2026-10-01" }),
    item({ id: "p1", kind: "PAYMENT", cents: -2_000n, number: "E-00001", date: "2026-10-20", dueDate: null }),
  ], "2026-10-31");

  it("has a row per item in its bucket, then the totals, with the decimal mark and the delimiter of the language", () => {
    const lines = agingCsv(aging, "2026-10-31", "Âge des comptes clients", labels, "fr-CA").split("\r\n");
    expect(lines[0]).toBe("Âge des comptes clients;;;;;;;;;;;;");
    expect(lines[1]).toBe("2026-10-31;;;;;;;;;;;;");
    expect(lines[2]).toBe("Client;Pièce;Numéro;Date;Échéance;Jours de retard;Courant;1–30 jours;31–60 jours;61–90 jours;91 jours et plus;Non appliqué;Total");
    expect(lines[3]).toBe("Client Un;Facture;F-00001;2026-09-01;2026-10-01;30;0,00;1234,56;0,00;0,00;0,00;0,00;1234,56");
    expect(lines[4]).toBe("Client Un;Encaissement;E-00001;2026-10-20;;;0,00;0,00;0,00;0,00;0,00;-20,00;-20,00");
    expect(lines[5]).toBe("Total;;;;;;0,00;1234,56;0,00;0,00;0,00;-20,00;1214,56");
    expect(lines[6]).toBe("");
    const english = agingCsv(aging, "2026-10-31", "Receivables aging", labels, "en").split("\r\n");
    expect(english[3]).toBe("Client Un,Facture,F-00001,2026-09-01,2026-10-01,30,0.00,1234.56,0.00,0.00,0.00,0.00,1234.56");
  });

  it("defuses a customer name a spreadsheet would run, and quotes one that holds the delimiter", () => {
    const hostile = buildAging([item({ id: "a", contactName: "=HYPERLINK(\"http://x\")", cents: 1n }), item({ id: "b", contactId: "c2", contactName: "Dupont; Fils", cents: 1n })], "2026-10-31");
    const lines = agingCsv(hostile, "2026-10-31", "t", labels, "fr-CA").split("\r\n");
    expect(lines[3]?.startsWith("\"'=HYPERLINK(\"\"http://x\"\")\";")).toBe(true);
    expect(lines[4]?.startsWith("\"Dupont; Fils\";")).toBe(true);
  });

  it("keeps the same number of columns on every line", () => {
    const text = agingCsv(aging, "2026-10-31", "Titre", labels, "en");
    for (const line of text.trimEnd().split("\r\n")) expect(line.split(",").length).toBe(13);
  });
});
