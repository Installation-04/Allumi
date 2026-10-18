import { randomUUID } from "node:crypto";
import fc from "fast-check";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeLedger, listAccounts, type Actor } from "@/modules/ledger";
import {
  addTaxRate,
  computeTaxes,
  createTax,
  createTaxCode,
  getTax,
  installQuebecTaxes,
  listTaxCodes,
  listTaxes,
  updateTax,
  updateTaxCode,
  QUEBEC_TAX_CODES,
  QUEBEC_TAXES,
  RATE_SCALE,
  rateOn,
} from "@/modules/taxes";
import { roundDiv } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { owner, seedCompany, seedUser } from "./helpers";

let db: pg.Client;
beforeAll(async () => {
  db = await owner();
});
afterAll(async () => {
  await db.end();
});

type World = { companyId: string; actor: Actor; accountant: Actor; reader: Actor };

async function newWorld(label: string, options: { ledger?: boolean } = {}): Promise<World> {
  const tag = randomUUID().slice(0, 8);
  const [ownerId, accountantId, readerId] = [
    await seedUser(db, { email: `proprio-${label}-${tag}@exemple.test` }),
    await seedUser(db, { email: `comptable-${label}-${tag}@exemple.test` }),
    await seedUser(db, { email: `lecture-${label}-${tag}@exemple.test` }),
  ];
  const companyId = await seedCompany(db, `Atelier taxes ${label} ${tag}`, [
    { userId: ownerId, role: "OWNER" },
    { userId: accountantId, role: "ACCOUNTANT" },
    { userId: readerId, role: "READ_ONLY" },
  ]);
  const actor = { userId: ownerId, companyId };
  if (options.ledger !== false) await initializeLedger(actor);
  return { companyId, actor, accountant: { userId: accountantId, companyId }, reader: { userId: readerId, companyId } };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.key;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the taxes of Québec", () => {
  it("installs GST and QST on the accounts of the starter chart, with their codes, and does it only once", async () => {
    const w = await newWorld("install");
    expect(await installQuebecTaxes(w.actor)).toEqual({ taxes: 2, codes: 5 });
    expect(await installQuebecTaxes(w.actor)).toEqual({ taxes: 0, codes: 0 });

    const taxes = await listTaxes(w.actor, { now: new Date("2026-06-15T12:00:00Z") });
    expect(taxes.map((tax) => [tax.code, tax.currentRateMicro])).toEqual([
      ["TPS", 50_000n],
      ["TVQ", 99_750n],
    ]);
    const accounts = await listAccounts(w.actor, { includeInactive: true });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const gst = taxes.find((tax) => tax.code === "TPS");
    expect(byId.get(gst?.payableAccountId ?? "")?.code).toBe("2100");
    expect(byId.get(gst?.recoverableAccountId ?? "")?.code).toBe("1200");

    const codes = await listTaxCodes(w.actor);
    expect(codes.map((code) => code.code).sort()).toEqual(QUEBEC_TAX_CODES.map((code) => code.code).sort());
    const both = codes.find((code) => code.code === "TPS-TVQ");
    expect(both?.taxes.map((tax) => tax.code)).toEqual(["TPS", "TVQ"]);
    expect(codes.find((code) => code.code === "EXONERE")).toMatchObject({ treatment: "EXEMPT", taxes: [] });
  });

  it("is refused to a read-only member, and the others read", async () => {
    const w = await newWorld("roles");
    expect(await refusal(installQuebecTaxes(w.reader))).toBe("forbidden");
    await installQuebecTaxes(w.accountant); // an accountant sets the taxes up
    expect((await listTaxes(w.reader)).length).toBe(2);
    expect((await listTaxCodes(w.reader)).length).toBe(5);
    expect(await refusal(createTax(w.reader, { code: "X", nameFr: "X", nameEn: "X", rateMicro: 1n, from: "2026-01-01" }))).toBe("forbidden");
  });

  it("keeps companies apart", async () => {
    const [a, b] = [await newWorld("iso-a"), await newWorld("iso-b")];
    await installQuebecTaxes(a.actor);
    expect(await listTaxes(b.actor)).toEqual([]);
    const aTax = (await listTaxes(a.actor))[0];
    expect(await getTax(b.actor, aTax?.id ?? "")).toBeNull();
    expect(await refusal(addTaxRate(b.actor, aTax?.id ?? "", { rateMicro: 10_000n, from: "2030-01-01" }))).toBe("taxes.notFound");
    // someone who is not a member of the company sees nothing, and cannot act
    expect(await refusal(listTaxes({ userId: b.actor.userId, companyId: a.companyId }))).toBe("forbidden");
  });

  it("installs on a company that has changed the codes of its tax accounts: the missing ones are created", async () => {
    const w = await newWorld("recode");
    await db.query("UPDATE account SET code = '2999' WHERE company_id = $1 AND code = '2100'", [w.companyId]);
    expect(await installQuebecTaxes(w.actor)).toEqual({ taxes: 2, codes: 5 });
    const gst = (await listTaxes(w.actor)).find((tax) => tax.code === "TPS");
    const accounts = await listAccounts(w.actor, { includeInactive: true });
    const payable = accounts.find((account) => account.id === gst?.payableAccountId);
    expect(payable).toMatchObject({ subtype: "SALES_TAX", type: "LIABILITY" });
    expect(payable?.code).not.toBe("2999"); // a new account on the next free code, the renamed one is left alone
  });
});

describe("a tax of one's own", () => {
  it("creates its accounts, its first rate and a code that uses it", async () => {
    const w = await newWorld("custom");
    const tax = await createTax(w.actor, { code: "tvh-on", nameFr: "TVH Ontario", nameEn: "HST Ontario", rateMicro: 130_000n, from: "2010-07-01", registrationNumber: "123456789 RT 0001" });
    expect(tax).toMatchObject({ code: "TVH-ON", registrationNumber: "123456789 RT 0001", currentRateMicro: 130_000n });
    expect(tax.recoverableAccountId).not.toBeNull();
    const accounts = await listAccounts(w.actor, { includeInactive: true });
    expect(accounts.filter((account) => account.subtype === "SALES_TAX" && [tax.payableAccountId, tax.recoverableAccountId].includes(account.id))).toHaveLength(2);

    const code = await createTaxCode(w.actor, { code: "tvh", nameFr: "TVH 13 %", nameEn: "HST 13%", treatment: "STANDARD", taxIds: [tax.id] });
    expect(code.taxes.map((t) => t.code)).toEqual(["TVH-ON"]);
  });

  it("refuses a duplicate code, bad data and accounts of the wrong kind", async () => {
    const w = await newWorld("custom-refusals");
    const input = { code: "TVQ2", nameFr: "TVQ 2", nameEn: "QST 2", rateMicro: 99_750n, from: "2013-01-01" };
    await createTax(w.actor, input);
    expect(await refusal(createTax(w.actor, input))).toBe("taxes.codeTaken");
    expect(await refusal(createTax(w.actor, { ...input, code: "mauvais code!" }))).toBe("taxes.invalid");
    expect(await refusal(createTax(w.actor, { ...input, code: "A", rateMicro: 1_000_000n }))).toBe("taxes.invalid");
    expect(await refusal(createTax(w.actor, { ...input, code: "B", from: "2026-02-30" }))).toBe("taxes.invalid");
    // a revenue account is not a tax account
    const revenue = (await listAccounts(w.actor)).find((account) => account.type === "REVENUE");
    expect(await refusal(createTax(w.actor, { ...input, code: "C", payableAccountId: revenue?.id }))).toBe("taxes.accountInvalid");
    // one account cannot be both
    const taxAccount = (await createTax(w.actor, { ...input, code: "D" })).payableAccountId;
    expect(await refusal(createTax(w.actor, { ...input, code: "E", payableAccountId: taxAccount, recoverableAccountId: taxAccount }))).toBe("taxes.accountInvalid");
  });

  it("answers 'code taken' to the loser of two simultaneous creations", async () => {
    const w = await newWorld("custom-race");
    const input = { code: "RACE", nameFr: "Course", nameEn: "Race", rateMicro: 50_000n, from: "2020-01-01" };
    const results = await Promise.allSettled([createTax(w.actor, input), createTax(w.actor, input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect((lost?.reason as AppError).key).toBe("taxes.codeTaken");
  });

  it("renames and deactivates a tax", async () => {
    const w = await newWorld("rename");
    const tax = await createTax(w.actor, { code: "T1", nameFr: "Ancienne", nameEn: "Old", rateMicro: 50_000n, from: "2020-01-01" });
    const updated = await updateTax(w.actor, tax.id, { nameFr: "Nouvelle", isActive: false });
    expect(updated).toMatchObject({ nameFr: "Nouvelle", nameEn: "Old", isActive: false });
    expect(await refusal(updateTax(w.reader, tax.id, { isActive: true }))).toBe("forbidden");
    expect(await refusal(updateTax(w.actor, randomUUID(), { isActive: true }))).toBe("taxes.notFound");
  });
});

describe("rates over time", () => {
  it("closes the rate in force the day before the new one starts, and finds the right rate for each date (P14)", async () => {
    const w = await newWorld("rates");
    const tax = await createTax(w.actor, { code: "TX", nameFr: "Taxe", nameEn: "Tax", rateMicro: 50_000n, from: "2020-01-01" });
    const next = await addTaxRate(w.actor, tax.id, { rateMicro: 60_000n, from: "2024-04-01" });
    const third = await addTaxRate(w.actor, tax.id, { rateMicro: 55_000n, from: "2026-01-01" });
    expect(third.rates.map((rate) => [rate.rateMicro, rate.from, rate.to])).toEqual([
      [55_000n, "2026-01-01", null],
      [60_000n, "2024-04-01", "2025-12-31"],
      [50_000n, "2020-01-01", "2024-03-31"],
    ]);
    expect(next.rates).toHaveLength(2);
    const rows = third.rates.map((rate) => ({ id: rate.id, rateMicro: rate.rateMicro, from: rate.from, to: rate.to }));
    expect(rateOn(rows, "2019-12-31")).toBeNull();
    expect(rateOn(rows, "2024-03-31")).toBe(50_000n);
    expect(rateOn(rows, "2024-04-01")).toBe(60_000n);
    expect(rateOn(rows, "2026-01-01")).toBe(55_000n);
  });

  it("refuses to rewrite history or to overlap", async () => {
    const w = await newWorld("rates-refusals");
    const tax = await createTax(w.actor, { code: "TX", nameFr: "Taxe", nameEn: "Tax", rateMicro: 50_000n, from: "2020-01-01" });
    expect(await refusal(addTaxRate(w.actor, tax.id, { rateMicro: 60_000n, from: "2020-01-01" }))).toBe("taxes.rate.notAfterLast");
    expect(await refusal(addTaxRate(w.actor, tax.id, { rateMicro: 60_000n, from: "2019-06-01" }))).toBe("taxes.rate.notAfterLast");
    expect(await refusal(addTaxRate(w.actor, tax.id, { rateMicro: 100_000_000n, from: "2025-01-01" }))).toBe("taxes.invalid");
    expect(await refusal(addTaxRate(w.reader, tax.id, { rateMicro: 60_000n, from: "2025-01-01" }))).toBe("forbidden");
    expect((await getTax(w.actor, tax.id))?.rates).toHaveLength(1);
  });

  it("answers the loser of two simultaneous rate changes with 'overlap' or 'not after the last', never a generic error", async () => {
    const w = await newWorld("rates-race");
    const tax = await createTax(w.actor, { code: "TX", nameFr: "Taxe", nameEn: "Tax", rateMicro: 50_000n, from: "2020-01-01" });
    const results = await Promise.allSettled([addTaxRate(w.actor, tax.id, { rateMicro: 60_000n, from: "2025-01-01" }), addTaxRate(w.actor, tax.id, { rateMicro: 70_000n, from: "2025-01-01" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(["taxes.rate.overlap", "taxes.rate.notAfterLast"]).toContain((lost?.reason as AppError).key);
    expect((await getTax(w.actor, tax.id))?.rates).toHaveLength(2);
  });
});

describe("tax codes", () => {
  it("needs taxes for a standard code and none for the others, as the database does", async () => {
    const w = await newWorld("codes");
    await installQuebecTaxes(w.actor);
    const gst = (await listTaxes(w.actor)).find((tax) => tax.code === "TPS");
    expect(await refusal(createTaxCode(w.actor, { code: "RIEN", nameFr: "Rien", nameEn: "None", treatment: "STANDARD", taxIds: [] }))).toBe("taxes.invalidCode");
    expect(await refusal(createTaxCode(w.actor, { code: "ZERO", nameFr: "Zéro", nameEn: "Zero", treatment: "ZERO_RATED", taxIds: [gst?.id ?? ""] }))).toBe("taxes.invalidCode");
    expect(await refusal(createTaxCode(w.actor, { code: "DOUBLE", nameFr: "D", nameEn: "D", treatment: "STANDARD", taxIds: [gst?.id ?? "", gst?.id ?? ""] }))).toBe("taxes.invalidCode");
    expect(await refusal(createTaxCode(w.actor, { code: "TPS", nameFr: "Autre", nameEn: "Other", treatment: "STANDARD", taxIds: [gst?.id ?? ""] }))).toBe("taxes.codeTaken");
    expect(await refusal(createTaxCode(w.actor, { code: "AUTRE", nameFr: "Autre", nameEn: "Other", treatment: "STANDARD", taxIds: [randomUUID()] }))).toBe("taxes.notFound");
    const ok = await createTaxCode(w.actor, { code: "TPS-SEULE", nameFr: "TPS seule", nameEn: "GST only", treatment: "STANDARD", taxIds: [gst?.id ?? ""] });
    await updateTaxCode(w.actor, ok.id, { nameFr: "TPS seulement (bis)", isActive: false });
    expect((await listTaxCodes(w.actor)).find((code) => code.id === ok.id)).toMatchObject({ nameFr: "TPS seulement (bis)", isActive: false });
  });
});

describe("the domain's tax arithmetic agrees with PostgreSQL's round(numeric) (P5, P16)", () => {
  it("gives the same cents as round(amount × rate) for random amounts and rates", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.bigInt({ min: -9_000_000_000n, max: 9_000_000_000n }), fc.bigInt({ min: 0n, max: 999_999n })), { minLength: 1, maxLength: 40 }),
        async (cases) => {
          const { rows } = await db.query(
            "SELECT round(a::numeric * (r::numeric / 1000000)::numeric(9,6)) AS cents FROM unnest($1::bigint[], $2::bigint[]) AS t(a, r)",
            [cases.map(([amount]) => amount.toString()), cases.map(([, rate]) => rate.toString())],
          );
          cases.forEach(([amount, rate], index) => {
            expect(roundDiv(amount * rate, RATE_SCALE).toString(), `${amount} × ${rate}`).toBe(String(rows[index].cents));
          });
        },
      ),
      { numRuns: 60 },
    );
  });

  it("matches the per-line and per-document sums that the database computes", async () => {
    const lines = [1_999n, 2_501n, 333n, -400n, 10n];
    const taxes = computeTaxes(lines.map((amountCents) => ({ amountCents, taxIds: ["qst"] })), new Map([["qst", 99_750n]]), "PER_LINE");
    const sql = await db.query("SELECT sum(round(a::numeric * 0.09975::numeric(9,6)))::bigint AS cents FROM unnest($1::bigint[]) AS t(a)", [lines.map(String)]);
    expect(taxes[0]?.amountCents.toString()).toBe(String(sql.rows[0].cents));
    const perDocument = computeTaxes(lines.map((amountCents) => ({ amountCents, taxIds: ["qst"] })), new Map([["qst", 99_750n]]), "PER_DOCUMENT");
    const sqlDoc = await db.query("SELECT round(sum(a)::numeric * 0.09975::numeric(9,6))::bigint AS cents FROM unnest($1::bigint[]) AS t(a)", [lines.map(String)]);
    expect(perDocument[0]?.amountCents.toString()).toBe(String(sqlDoc.rows[0].cents));
  });

  it("starts the Québec taxes with the rates stored the way the database reads them", async () => {
    const w = await newWorld("stored");
    await installQuebecTaxes(w.actor);
    const { rows } = await db.query("SELECT t.code, r.rate::text AS rate, r.effective_from::text AS from FROM tax t JOIN tax_rate r ON r.tax_id = t.id WHERE t.company_id = $1 ORDER BY t.code", [w.companyId]);
    expect(rows).toEqual(QUEBEC_TAXES.map((tax) => ({ code: tax.code, rate: tax.code === "TPS" ? "0.050000" : "0.099750", from: tax.from })));
  });
});
