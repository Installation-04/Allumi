import { randomUUID } from "node:crypto";
import fc from "fast-check";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAuditLog } from "@/modules/audit";
import {
  CANADIAN_CHART,
  closeFiscalYear,
  createAccount,
  createFiscalYear,
  deleteAccount,
  formatMoney,
  getEntry,
  getTrialBalance,
  initializeLedger,
  isBalanced,
  ledgerStatus,
  listAccounts,
  listEntries,
  listFiscalYears,
  lockPeriod,
  postManualEntry,
  reopenFiscalYear,
  reopenPeriod,
  reverseEntry,
  roundDiv,
  todayIso,
  type Actor,
  type ManualEntryInput,
} from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { enableTotp, owner, seedCompany, seedUser } from "./helpers";

let db: pg.Client;
beforeAll(async () => {
  db = await owner();
});
afterAll(async () => {
  await db.end();
});

type Company = { companyId: string; ownerId: string; ownerEmail: string; accountantId: string; readerId: string; actor: Actor; accountant: Actor; reader: Actor; year: string };

/** A fresh company with its three roles, its chart, its numbering and the fiscal year of today. */
async function newCompany(label: string): Promise<Company> {
  const tag = randomUUID().slice(0, 8);
  const ownerEmail = `proprio-${label}-${tag}@exemple.test`;
  const [ownerId, accountantId, readerId] = [
    await seedUser(db, { email: ownerEmail }),
    await seedUser(db, { email: `comptable-${label}-${tag}@exemple.test` }),
    await seedUser(db, { email: `lecture-${label}-${tag}@exemple.test` }),
  ];
  const companyId = await seedCompany(db, `Atelier ${label} ${tag}`, [
    { userId: ownerId, role: "OWNER" },
    { userId: accountantId, role: "ACCOUNTANT" },
    { userId: readerId, role: "READ_ONLY" },
  ]);
  const actor = { userId: ownerId, companyId };
  await initializeLedger(actor);
  const [latest] = await listFiscalYears(actor);
  return { companyId, ownerId, ownerEmail, accountantId, readerId, actor, accountant: { userId: accountantId, companyId }, reader: { userId: readerId, companyId }, year: (latest?.start ?? todayIso()).slice(0, 4) };
}

async function codes(actor: Actor): Promise<Record<string, string>> {
  return Object.fromEntries((await listAccounts(actor, { includeInactive: true })).map((account) => [account.code, account.id]));
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

const entry = (date: string, lines: [string, bigint, bigint][], extra: Partial<ManualEntryInput> = {}): ManualEntryInput => ({
  date,
  kind: "MANUAL",
  memo: "Écriture de test",
  lines: lines.map(([accountId, debitCents, creditCents]) => ({ accountId, debitCents, creditCents })),
  ...extra,
});

describe("initialization", () => {
  it("gives a new company its chart, numbering and fiscal year, and does it only once", async () => {
    const c = await newCompany("init");
    const status = await ledgerStatus(c.actor);
    expect(status).toEqual({ initialized: true, accounts: CANADIAN_CHART.length, fiscalYears: 1 });
    const again = await initializeLedger(c.actor);
    expect(again).toEqual(status);

    const [year] = await listFiscalYears(c.actor);
    expect(year?.periods).toHaveLength(12);
    expect(year?.periods.every((period) => period.status === "OPEN")).toBe(true);
    const accounts = await listAccounts(c.actor);
    expect(accounts.filter((account) => account.systemKey).map((account) => account.systemKey).sort()).toEqual([
      "ACCOUNTS_PAYABLE",
      "ACCOUNTS_RECEIVABLE",
      "OPENING_BALANCE_EQUITY",
      "RETAINED_EARNINGS",
      "UNDEPOSITED_FUNDS",
    ]);
    const sequences = await db.query("SELECT count(*)::int AS n FROM number_sequence WHERE company_id = $1", [c.companyId]);
    expect(sequences.rows[0].n).toBe(7);
  });

  it("is refused to a read-only member", async () => {
    const c = await newCompany("init-ro");
    expect(await refusal(initializeLedger(c.reader))).toBe("forbidden");
  });

  /** A company that exists but whose ledger was never initialized. */
  async function bareCompany(label: string): Promise<{ actor: Actor; ownerId: string }> {
    const tag = randomUUID().slice(0, 8);
    const ownerId = await seedUser(db, { email: `nu-${label}-${tag}@exemple.test` });
    const companyId = await seedCompany(db, `Atelier nu ${label} ${tag}`, [{ userId: ownerId, role: "OWNER" }]);
    return { actor: { userId: ownerId, companyId }, ownerId };
  }

  it("still adds the system accounts to a company that already has an account, even on the code of the template", async () => {
    const { actor } = await bareCompany("deja");
    await createAccount(actor, { code: "1100", nameFr: "Mon compte", nameEn: "My account", type: "ASSET", subtype: "CURRENT_ASSET" });
    await createAccount(actor, { code: "9999", nameFr: "Autre", nameEn: "Other", type: "EXPENSE", subtype: "OPERATING_EXPENSE" });
    const status = await initializeLedger(actor);
    expect(status.initialized).toBe(true);
    const accounts = await listAccounts(actor, { includeInactive: true });
    const system = accounts.filter((account) => account.systemKey);
    expect(system.map((account) => account.systemKey).sort()).toEqual(["ACCOUNTS_PAYABLE", "ACCOUNTS_RECEIVABLE", "OPENING_BALANCE_EQUITY", "RETAINED_EARNINGS", "UNDEPOSITED_FUNDS"]);
    // the user's account keeps its code; the receivables account takes the next free one
    expect(accounts.find((account) => account.code === "1100")?.systemKey).toBeNull();
    expect(system.find((account) => account.systemKey === "ACCOUNTS_RECEIVABLE")?.code).toBe("1101");
    // the rest of the chart is not forced on a company that organized its own
    expect(accounts).toHaveLength(2 + 5);
    expect(await initializeLedger(actor)).toEqual(status);
  });

  it("gives the same result when two requests initialize at once (a double click)", async () => {
    const { actor } = await bareCompany("double");
    const results = await Promise.all([initializeLedger(actor), initializeLedger(actor)]);
    expect(results[0]).toEqual({ initialized: true, accounts: CANADIAN_CHART.length, fiscalYears: 1 });
    expect(results[1]).toEqual(results[0]);
    expect(await listFiscalYears(actor)).toHaveLength(1);
  });
});

describe("posting entries", () => {
  it("numbers entries one after the other and keeps the trial balance at zero", async () => {
    const c = await newCompany("post");
    const a = await codes(c.actor);
    const first = await postManualEntry(c.actor, entry(`${c.year}-03-15`, [[a["1000"] ?? "", 100_000n, 0n], [a["3000"] ?? "", 0n, 100_000n]]));
    const second = await postManualEntry(c.accountant, entry(`${c.year}-03-16`, [[a["6050"] ?? "", 25_000n, 0n], [a["1000"] ?? "", 0n, 25_000n]]));
    expect([first.number, second.number]).toEqual([1n, 2n]);

    const posted = await getEntry(c.actor, first.id);
    expect(posted?.numberLabel).toBe("J-00001");
    expect(posted?.totalCents).toBe(100_000n);
    expect(posted?.lines.map((line) => [line.accountCode, line.debitCents, line.creditCents])).toEqual([
      ["1000", 100_000n, 0n],
      ["3000", 0n, 100_000n],
    ]);

    const trial = await getTrialBalance(c.actor);
    expect(trial.balanced).toBe(true);
    expect(trial.equationHolds).toBe(true);
    expect(trial.totalDebitCents).toBe(125_000n);
    expect(trial.totalCreditCents).toBe(125_000n);
    expect(trial.lines.find((line) => line.code === "1000")).toMatchObject({ debitCents: 100_000n, creditCents: 25_000n });
    // up to a date
    const early = await getTrialBalance(c.actor, { asOf: `${c.year}-03-15` });
    expect(early.totalDebitCents).toBe(100_000n);
  });

  it("refuses what the domain or the rules refuse, with the message of the matching rule", async () => {
    const c = await newCompany("refuse");
    const a = await codes(c.actor);
    const day = `${c.year}-04-10`;
    expect(await refusal(postManualEntry(c.actor, entry(day, [[a["1000"] ?? "", 100n, 0n], [a["3000"] ?? "", 0n, 99n]])))).toBe("AL001");
    expect(await refusal(postManualEntry(c.actor, entry(day, [[a["1000"] ?? "", 100n, 0n]])))).toBe("AL002");
    expect(await refusal(postManualEntry(c.actor, entry(day, [[a["1000"] ?? "", 100n, 100n], [a["3000"] ?? "", 0n, 0n]])))).toBe("ledger.invalidLine");
    // control account: receivables only through documents and payments
    expect(await refusal(postManualEntry(c.actor, entry(day, [[a["1100"] ?? "", 100n, 0n], [a["3000"] ?? "", 0n, 100n]])))).toBe("ledger.accountNotAllowed");
    // an account that belongs to someone else's company
    const other = await newCompany("refuse-other");
    const foreign = (await codes(other.actor))["1000"] ?? "";
    expect(await refusal(postManualEntry(c.actor, entry(day, [[foreign, 100n, 0n], [a["3000"] ?? "", 0n, 100n]])))).toBe("ledger.accountNotAllowed");
    // no fiscal period for the date
    expect(await refusal(postManualEntry(c.actor, entry("1999-01-01", [[a["1000"] ?? "", 100n, 0n], [a["3000"] ?? "", 0n, 100n]])))).toBe("ledger.noPeriod");
    // an inactive account
    await db.query("UPDATE account SET is_active = false WHERE id = $1", [a["6040"]]);
    expect(await refusal(postManualEntry(c.actor, entry(day, [[a["6040"] ?? "", 100n, 0n], [a["3000"] ?? "", 0n, 100n]])))).toBe("ledger.accountNotAllowed");
    // nothing was posted, and the numbers were given back
    expect((await listEntries(c.actor)).total).toBe(0);
    const ok = await postManualEntry(c.actor, entry(day, [[a["1000"] ?? "", 100n, 0n], [a["3000"] ?? "", 0n, 100n]]));
    expect(ok.number).toBe(1n);
  });

  it("lets the accountant write and the read-only member read, nothing more", async () => {
    const c = await newCompany("roles");
    const a = await codes(c.actor);
    const lines: [string, bigint, bigint][] = [[a["1000"] ?? "", 500n, 0n], [a["3000"] ?? "", 0n, 500n]];
    const posted = await postManualEntry(c.accountant, entry(`${c.year}-05-02`, lines));
    expect(await refusal(postManualEntry(c.reader, entry(`${c.year}-05-02`, lines)))).toBe("forbidden");
    expect(await refusal(reverseEntry(c.reader, posted.id))).toBe("forbidden");
    expect(await refusal(createAccount(c.reader, { code: "9999", nameFr: "X", nameEn: "X", type: "EXPENSE", subtype: "OPERATING_EXPENSE" }))).toBe("forbidden");
    expect((await listEntries(c.reader)).total).toBe(1);
    expect((await getTrialBalance(c.reader)).balanced).toBe(true);
  });

  it("keeps companies apart: no member of A sees, reverses or posts in B", async () => {
    const a = await newCompany("iso-a");
    const b = await newCompany("iso-b");
    const accountsA = await codes(a.actor);
    const posted = await postManualEntry(a.actor, entry(`${a.year}-06-01`, [[accountsA["1000"] ?? "", 100n, 0n], [accountsA["3000"] ?? "", 0n, 100n]]));

    expect((await listEntries(b.actor)).total).toBe(0);
    expect(await getEntry(b.actor, posted.id)).toBeNull();
    expect(await refusal(reverseEntry(b.actor, posted.id))).toBe("ledger.entryNotFound");
    // user of B pointing at the company of A (IDOR): the database does not honour the company
    const intruder: Actor = { userId: b.ownerId, companyId: a.companyId };
    expect(await refusal(listAccounts(intruder))).toBe("forbidden");
    expect(await refusal(postManualEntry(intruder, entry(`${a.year}-06-02`, [[accountsA["1000"] ?? "", 1n, 0n], [accountsA["3000"] ?? "", 0n, 1n]])))).toBe("forbidden");
    expect(await refusal(getTrialBalance(intruder))).toBe("forbidden");
    expect((await listEntries(a.actor)).total).toBe(1);
  });

  it("P13: concurrent postings get exactly the numbers 1..N", async () => {
    const c = await newCompany("numbers");
    const a = await codes(c.actor);
    const posted = await Promise.all(
      Array.from({ length: 8 }, (_, i) => postManualEntry(c.actor, entry(`${c.year}-07-${String(i + 1).padStart(2, "0")}`, [[a["1000"] ?? "", 100n, 0n], [a["3000"] ?? "", 0n, 100n]]))),
    );
    expect(posted.map((p) => p.number).sort((x, y) => (x < y ? -1 : 1))).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
  });
});

describe("reversal", () => {
  it("mirrors the entry, leaves every balance unchanged, and happens once", async () => {
    const c = await newCompany("reverse");
    const a = await codes(c.actor);
    const original = await postManualEntry(c.actor, entry(`${c.year}-02-10`, [[a["6050"] ?? "", 80_000n, 0n], [a["1000"] ?? "", 0n, 80_000n]]));
    const before = await getTrialBalance(c.actor);
    expect(before.lines.find((line) => line.code === "6050")?.debitCents).toBe(80_000n);

    const reversal = await reverseEntry(c.actor, original.id, { date: `${c.year}-02-20`, memo: "Erreur de compte" });
    const after = await getTrialBalance(c.actor);
    expect(after.balanced).toBe(true);
    // each account nets to zero: the entry and its mirror cancel
    for (const line of after.lines) expect(line.debitCents - line.creditCents).toBe(0n);
    expect(after.lines.find((line) => line.code === "6050")).toMatchObject({ debitCents: 80_000n, creditCents: 80_000n });

    const posted = await getEntry(c.actor, original.id);
    const mirror = await getEntry(c.actor, reversal.id);
    expect(posted?.reversedByEntryId).toBe(reversal.id);
    expect(mirror).toMatchObject({ source: "REVERSAL", reversesEntryId: original.id, memo: "Erreur de compte" });

    expect(await refusal(reverseEntry(c.actor, original.id))).toBe("ledger.alreadyReversed");
    expect(await refusal(reverseEntry(c.actor, reversal.id))).toBe("AL008");
  });

  it("refuses an impossible date and an oversized memo, and does not number anything for them", async () => {
    const c = await newCompany("reverse-input");
    const a = await codes(c.actor);
    const original = await postManualEntry(c.actor, entry(`${c.year}-03-10`, [[a["6050"] ?? "", 1_000n, 0n], [a["1000"] ?? "", 0n, 1_000n]]));
    // 30 February would silently become 2 March
    expect(await refusal(reverseEntry(c.actor, original.id, { date: `${c.year}-02-30` }))).toBe("ledger.invalidEntry");
    expect(await refusal(reverseEntry(c.actor, original.id, { date: "pas une date" }))).toBe("ledger.invalidEntry");
    expect(await refusal(reverseEntry(c.actor, original.id, { memo: "x".repeat(501) }))).toBe("ledger.invalidEntry");
    const ok = await reverseEntry(c.actor, original.id, { date: `${c.year}-03-11`, memo: "  motif  " });
    expect(ok.number).toBe(2n);
    expect((await getEntry(c.actor, ok.id))?.memo).toBe("motif");
  });

  it("answers 'already reversed' to the loser of two simultaneous reversals", async () => {
    const c = await newCompany("reverse-race");
    const a = await codes(c.actor);
    const original = await postManualEntry(c.actor, entry(`${c.year}-03-10`, [[a["6050"] ?? "", 1_000n, 0n], [a["1000"] ?? "", 0n, 1_000n]]));
    const results = await Promise.allSettled([reverseEntry(c.actor, original.id, { date: `${c.year}-03-12` }), reverseEntry(c.actor, original.id, { date: `${c.year}-03-12` })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(lost?.reason).toBeInstanceOf(AppError);
    expect((lost?.reason as AppError).key).toBe("ledger.alreadyReversed");
    const trial = await getTrialBalance(c.actor);
    expect(trial.balanced).toBe(true);
    for (const line of trial.lines) expect(line.debitCents - line.creditCents).toBe(0n);
    expect(await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE company_id = $1", [c.companyId]).then((r) => r.rows[0].n)).toBe(2);
  });

  it("is never dated before the entry, and goes to an open period", async () => {
    const c = await newCompany("reverse-date");
    const a = await codes(c.actor);
    const original = await postManualEntry(c.actor, entry(`${c.year}-03-10`, [[a["6050"] ?? "", 1_000n, 0n], [a["1000"] ?? "", 0n, 1_000n]]));
    expect(await refusal(reverseEntry(c.actor, original.id, { date: `${c.year}-03-09` }))).toBe("AL008");
    // lock the period of the entry: the reversal can still be posted in a later, open period
    const [year] = await listFiscalYears(c.actor);
    const march = year?.periods.find((period) => period.start === `${c.year}-03-01`);
    await lockPeriod(c.actor, march?.id ?? "");
    expect(await refusal(reverseEntry(c.actor, original.id, { date: `${c.year}-03-20` }))).toBe("AL003");
    const reversal = await reverseEntry(c.actor, original.id, { date: `${c.year}-04-02` });
    expect((await getEntry(c.actor, reversal.id))?.date).toBe(`${c.year}-04-02`);
  });
});

describe("fiscal years and periods", () => {
  it("locks a period for everybody, and reopens it only with two-factor authentication and a reason", async () => {
    const c = await newCompany("periods");
    const a = await codes(c.actor);
    const [year] = await listFiscalYears(c.actor);
    const june = year?.periods.find((period) => period.start === `${c.year}-06-01`);
    const lines: [string, bigint, bigint][] = [[a["1000"] ?? "", 100n, 0n], [a["3000"] ?? "", 0n, 100n]];

    await lockPeriod(c.accountant, june?.id ?? "");
    expect(await refusal(postManualEntry(c.actor, entry(`${c.year}-06-15`, lines)))).toBe("AL003");
    expect(await refusal(lockPeriod(c.reader, june?.id ?? ""))).toBe("forbidden");

    // privileged: owner only, 2FA on, a code typed now, a real reason
    const why = "Correction d'une écriture oubliée";
    expect(await refusal(reopenPeriod(c.accountant, june?.id ?? "", why, { code: "000000" }))).toBe("forbidden");
    expect(await refusal(reopenPeriod(c.actor, june?.id ?? "", why, { code: "000000" }))).toBe("ledger.twoFactorRequired");
    const totp = await enableTotp(c.ownerId, c.ownerEmail);
    const at = (step: number) => totp.enrolledAt + step * 30_000;
    const proof = (step: number) => ({ code: totp.code(at(step)), now: new Date(at(step)) });
    expect(await refusal(reopenPeriod(c.actor, june?.id ?? "", "oups", proof(1)))).toBe("ledger.reasonRequired");
    // a session cookie is not enough: without a valid code nothing reopens
    expect(await refusal(reopenPeriod(c.actor, june?.id ?? "", why, { code: "000000", now: new Date(at(1)) }))).toBe("ledger.codeInvalid");
    expect((await listFiscalYears(c.actor))[0]?.periods.find((period) => period.id === june?.id)?.status).toBe("LOCKED");
    await reopenPeriod(c.actor, june?.id ?? "", why, proof(2));
    // a code is good once: replaying it is refused, the next step's code works
    await lockPeriod(c.actor, june?.id ?? "");
    expect(await refusal(reopenPeriod(c.actor, june?.id ?? "", why, proof(2)))).toBe("ledger.codeInvalid");
    await reopenPeriod(c.actor, june?.id ?? "", why, proof(3));
    // a recovery code does the same job, once
    await lockPeriod(c.actor, june?.id ?? "");
    const recovery = totp.recoveryCodes[0] ?? "";
    await reopenPeriod(c.actor, june?.id ?? "", why, { code: recovery, now: new Date(at(4)) });
    await lockPeriod(c.actor, june?.id ?? "");
    expect(await refusal(reopenPeriod(c.actor, june?.id ?? "", why, { code: recovery, now: new Date(at(5)) }))).toBe("ledger.codeInvalid");
    await reopenPeriod(c.actor, june?.id ?? "", why, proof(6));

    const posted = await postManualEntry(c.actor, entry(`${c.year}-06-15`, lines));
    expect(posted.number).toBe(1n);

    // the reopening is on the audit trail, with its reason and its author
    const audit = await listAuditLog(c.actor, { action: "period.reopen" });
    expect(audit.entries).toHaveLength(4); // one event per reopening: the refused attempts left none
    expect(audit.entries[0]).toMatchObject({ entityType: "fiscal_period", entityId: june?.id });
    expect(JSON.stringify(audit.entries[0]?.after)).toContain("Correction d'une écriture oubliée");
  });

  it("closes a year only when every period is locked, and reopens it with the same conditions", async () => {
    const c = await newCompany("close");
    const [year] = await listFiscalYears(c.actor);
    expect(await refusal(closeFiscalYear(c.actor, year?.id ?? ""))).toBe("AL003");
    expect(await refusal(closeFiscalYear(c.accountant, year?.id ?? ""))).toBe("forbidden");
    for (const period of year?.periods ?? []) await lockPeriod(c.actor, period.id);
    await closeFiscalYear(c.actor, year?.id ?? "");
    expect((await listFiscalYears(c.actor)).find((candidate) => candidate.id === year?.id)?.status).toBe("CLOSED");

    const totp = await enableTotp(c.ownerId, c.ownerEmail);
    const proof = (step: number) => ({ code: totp.code(totp.enrolledAt + step * 30_000), now: new Date(totp.enrolledAt + step * 30_000) });
    expect(await refusal(reopenFiscalYear(c.actor, year?.id ?? "", "court", proof(1)))).toBe("ledger.reasonRequired");
    expect(await refusal(reopenFiscalYear(c.actor, year?.id ?? "", "Régularisation demandée par la comptable", { code: "123456", now: new Date(totp.enrolledAt + 30_000) }))).toBe("ledger.codeInvalid");
    await reopenFiscalYear(c.actor, year?.id ?? "", "Régularisation demandée par la comptable", proof(1));
    expect((await listFiscalYears(c.actor)).find((candidate) => candidate.id === year?.id)?.status).toBe("OPEN");
  });

  it("creates the next years one after the other, and a past year on request, never overlapping", async () => {
    const c = await newCompany("years");
    const first = (await listFiscalYears(c.actor))[0];
    const next = await createFiscalYear(c.actor);
    expect(next.periods).toHaveLength(12);
    expect(next.start).toBe(`${Number(c.year) + 1}-01-01`);
    const third = await createFiscalYear(c.actor);
    expect(third.start).toBe(`${Number(c.year) + 2}-01-01`);
    const past = await createFiscalYear(c.actor, { containing: `${Number(c.year) - 1}-08-15` });
    expect([past.start, past.end]).toEqual([`${Number(c.year) - 1}-01-01`, `${Number(c.year) - 1}-12-31`]);
    expect(await refusal(createFiscalYear(c.actor, { containing: first?.start ?? "" }))).toBe("ledger.fiscalYearExists");
    expect(await refusal(createFiscalYear(c.reader))).toBe("forbidden");
    const years = await listFiscalYears(c.actor);
    expect(years.map((year) => year.start)).toEqual([...years.map((year) => year.start)].sort().reverse());
  });
});

describe("accounts", () => {
  it("creates, renames, deactivates and deletes an unused account; protects the used and the system ones", async () => {
    const c = await newCompany("accounts");
    const created = await createAccount(c.actor, { code: "6200", nameFr: "Frais divers", nameEn: "Sundry expenses", type: "EXPENSE", subtype: "OPERATING_EXPENSE" });
    expect(created).toMatchObject({ code: "6200", isActive: true, systemKey: null });
    expect(await refusal(createAccount(c.actor, { code: "6200", nameFr: "Autre", nameEn: "Other", type: "EXPENSE", subtype: "OPERATING_EXPENSE" }))).toBe("ledger.codeTaken");
    expect(await refusal(createAccount(c.actor, { code: "6201", nameFr: "X", nameEn: "X", type: "ASSET", subtype: "ACCOUNTS_RECEIVABLE" }))).toBe("ledger.invalidAccount");

    const renamed = await (await import("@/modules/ledger")).updateAccount(c.actor, created.id, { nameFr: "Frais généraux divers", isActive: false });
    expect(renamed).toMatchObject({ nameFr: "Frais généraux divers", isActive: false });
    expect((await listAccounts(c.actor)).some((account) => account.id === created.id)).toBe(false);
    expect((await listAccounts(c.actor, { includeInactive: true })).some((account) => account.id === created.id)).toBe(true);

    const a = await codes(c.actor);
    expect(await refusal(deleteAccount(c.actor, a["1100"] ?? ""))).toBe("AL005"); // system account
    await postManualEntry(c.actor, entry(`${c.year}-01-15`, [[a["1000"] ?? "", 10n, 0n], [a["3000"] ?? "", 0n, 10n]]));
    expect(await refusal(deleteAccount(c.actor, a["1000"] ?? ""))).toBe("ledger.accountInUse");
    await deleteAccount(c.actor, created.id);
    expect((await listAccounts(c.actor, { includeInactive: true })).some((account) => account.id === created.id)).toBe(false);
  });
});

describe("audit trail", () => {
  it("records who posted what, shows it to owners and accountants, and hides it from read-only members", async () => {
    const c = await newCompany("audit");
    const a = await codes(c.actor);
    const posted = await postManualEntry(c.accountant, entry(`${c.year}-08-01`, [[a["1000"] ?? "", 700n, 0n], [a["3000"] ?? "", 0n, 700n]]));

    const rows = await listAuditLog(c.actor, { entityType: "journal_entry" });
    const insert = rows.entries.find((row) => row.entityId === posted.id);
    expect(insert).toMatchObject({ action: "row.insert", actorKind: "USER" });
    expect(insert?.actorName).toContain("comptable-audit");
    expect(JSON.stringify(insert?.after)).toContain(posted.id);
    expect(await refusal(listAuditLog(c.reader))).toBe("forbidden");

    // once the accountant is no longer a member, the trail keeps who did it (id), though their name is out of sight
    await db.query("DELETE FROM membership WHERE company_id = $1 AND user_id = $2", [c.companyId, c.accountantId]);
    const later = await listAuditLog(c.actor, { entityType: "journal_entry" });
    const kept = later.entries.find((row) => row.entityId === posted.id);
    expect(kept).toMatchObject({ actorKind: "USER", actorUserId: c.accountantId, actorName: null });

    // pages: newest first, a cursor continues where the previous page stopped
    const all = await listAuditLog(c.actor);
    const ids = all.entries.map((row) => BigInt(row.id));
    expect([...ids].sort((x, y) => (x > y ? -1 : 1))).toEqual(ids);
    if (all.nextCursor) {
      const next = await listAuditLog(c.actor, { before: all.nextCursor });
      expect(next.entries.every((row) => BigInt(row.id) < BigInt(all.nextCursor ?? "0"))).toBe(true);
    }
  });
});

describe("properties on the real database", () => {
  const amount = fc.bigInt({ min: 1n, max: 1_000_000_000n });
  const slots = ["1000", "1010", "1400", "1500", "2050", "3000", "4000", "6050", "6100", "7000"] as const;
  const entries = fc.array(
    fc.record({
      amount,
      debit: fc.constantFrom(...slots),
      credit: fc.constantFrom(...slots),
      day: fc.integer({ min: 1, max: 28 }),
      month: fc.integer({ min: 1, max: 12 }),
    }),
    { minLength: 1, maxLength: 6 },
  );

  it("P1/P8: after any sequence of valid entries the trial balance is at zero and the equation holds", async () => {
    await fc.assert(
      fc.asyncProperty(entries, async (sequence) => {
        const c = await newCompany("p1");
        const a = await codes(c.actor);
        for (const e of sequence) {
          const date = `${c.year}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
          await postManualEntry(c.actor, entry(date, [[a[e.debit] ?? "", e.amount, 0n], [a[e.credit] ?? "", 0n, e.amount]]));
        }
        const trial = await getTrialBalance(c.actor);
        expect(trial.balanced).toBe(true);
        expect(trial.equationHolds).toBe(true);
        expect(trial.totalDebitCents).toBe(sequence.reduce((sum, e) => sum + e.amount, 0n));
        const rows = trial.lines.map(({ accountId, debitCents, creditCents }) => ({ accountId, debitCents, creditCents }));
        expect(isBalanced(rows)).toBe(true);
      }),
      { numRuns: 12 },
    );
  });

  it("P3: an entry followed by its reversal leaves every balance of the ledger unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(entries, async (sequence) => {
        const c = await newCompany("p3");
        const a = await codes(c.actor);
        const post = async (e: (typeof sequence)[number]) =>
          postManualEntry(c.actor, entry(`${c.year}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`, [[a[e.debit] ?? "", e.amount, 0n], [a[e.credit] ?? "", 0n, e.amount]]));
        const extra = sequence[sequence.length - 1];
        for (const e of sequence.slice(0, -1)) await post(e);
        const net = async () => new Map((await getTrialBalance(c.actor)).lines.map((line) => [line.code, line.debitCents - line.creditCents]));
        const before = await net();
        if (!extra) return;
        const posted = await post(extra);
        await reverseEntry(c.actor, posted.id, { date: `${c.year}-12-31` });
        const after = await net();
        for (const code of new Set([...before.keys(), ...after.keys()])) expect(after.get(code) ?? 0n, code).toBe(before.get(code) ?? 0n);
      }),
      { numRuns: 12 },
    );
  });

  it("P5: roundDiv gives what PostgreSQL's round(numeric) gives", async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), fc.constantFrom(1n, 10n, 100n, 1_000n, 10_000n, 1_000_000n), async (n, d) => {
        const result = await db.query("SELECT round($1::numeric / $2::numeric)::text AS r", [n.toString(), d.toString()]);
        expect(roundDiv(n, d).toString()).toBe(result.rows[0].r);
      }),
      { numRuns: 100 },
    );
  });
});

describe("display", () => {
  it("shows amounts as people read them", () => {
    expect(formatMoney(2_500_000n, "fr-CA")).toBe("25 000,00 $");
  });
});
