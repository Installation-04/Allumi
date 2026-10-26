import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearMatchedLines, completeReconciliation, discardReconciliation, getWorksheet, listAccountReconciliations, listReconciliations, matchTransaction, reopenReconciliation, saveCleared, startReconciliation,
} from "@/modules/banking";
import { postManualEntry, reverseEntry } from "@/modules/ledger";
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
  await db.query("INSERT INTO number_sequence (company_id, key, next_value, prefix, padding) VALUES ($1, 'JOURNAL_ENTRY', 1, 'J-', 5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });

async function refusal(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { if (error instanceof AppError) return error.key; throw error; }
  throw new Error("expected a refusal");
}
const count = async (sql: string, args: unknown[] = []) => (await db.query(`SELECT count(*)::int AS n FROM ${sql}`, args)).rows[0].n as number;

/** A statement account of its own for each test, so no line ever meets another test's. */
async function account(subtype = "BANK", over: { active?: boolean; company?: string } = {}): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO account (id, company_id, code, name_fr, name_en, type, subtype, is_active, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7::account_subtype, $8, now())", [
    id, over.company ?? W.companyA, `18${String(++accountCounter).padStart(2, "0")}`, `Compte ${accountCounter}`, `Account ${accountCounter}`, subtype === "CREDIT_CARD" ? "LIABILITY" : "ASSET", subtype, over.active ?? true,
  ]);
  return id;
}

/** A manual entry that moves `cents` on the account against `against`: positive is money in (a debit). Returns the id of its line on the account. */
async function post(accountId: string, date: string, cents: bigint, against: string = W.sales, memo: string | null = "Écriture"): Promise<{ entryId: string; lineId: string }> {
  const abs = cents < 0n ? -cents : cents;
  const entry = await postManualEntry(actor, {
    date, kind: "MANUAL", memo,
    lines: [
      { accountId, debitCents: cents > 0n ? abs : 0n, creditCents: cents < 0n ? abs : 0n },
      { accountId: against, debitCents: cents < 0n ? abs : 0n, creditCents: cents > 0n ? abs : 0n },
    ],
  });
  const lines = (await db.query("SELECT id FROM journal_line WHERE entry_id = $1 AND account_id = $2", [entry.id, accountId])).rows;
  return { entryId: entry.id, lineId: lines[0].id as string };
}

/** A statement line, as an import leaves it. */
async function line(accountId: string, date: string, cents: bigint, description = "Ligne de relevé"): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO bank_transaction (id, company_id, account_id, txn_date, amount_cents, description, dedupe_key, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())", [id, W.companyA, accountId, date, cents.toString(), description, `test:${id}`]);
  return id;
}

const state = async (id: string) => (await db.query("SELECT status::text AS status, statement_balance_cents::text AS balance, completed_at, completed_by_id FROM bank_reconciliation WHERE id = $1", [id])).rows[0];
const ticked = async (id: string) => (await db.query("SELECT journal_line_id FROM reconciled_line WHERE reconciliation_id = $1 ORDER BY journal_line_id", [id])).rows.map((row) => row.journal_line_id as string);
async function inTransaction(run: () => Promise<void>) {
  await db.query("BEGIN");
  try { await run(); await db.query("COMMIT"); } catch (error) { await db.query("ROLLBACK"); throw error; }
}

/** A reconciliation in progress for a statement of this day and balance. */
async function begin(accountId: string, date: string, cents: bigint, who: CompanyContext = actor): Promise<string> {
  return (await startReconciliation(who, { accountId, statementDate: date, statementBalanceCents: cents })).id;
}

describe("starting a reconciliation", () => {
  it("keeps the statement's day and balance, in progress, for the owner and the accountant", async () => {
    const bank = await account();
    const id = await begin(bank, "2026-03-31", 123_456n, accountant);
    expect(await state(id)).toMatchObject({ status: "IN_PROGRESS", balance: "123456", completed_at: null });
    expect((await db.query("SELECT created_by_id, statement_date::text AS d FROM bank_reconciliation WHERE id = $1", [id])).rows[0]).toEqual({ created_by_id: W.userAccountant, d: "2026-03-31" });
    const listed = (await listAccountReconciliations(reader)).find((row) => row.accountId === bank);
    expect(listed).toMatchObject({ code: expect.stringMatching(/^18/), inProgress: { id, statementDate: "2026-03-31", statementBalanceCents: 123_456n, sign: 1, status: "IN_PROGRESS" }, lastCompleted: null });
  });

  it("takes what a card statement says, what is owed, and keeps it the way the ledger adds up", async () => {
    const card = await account("CREDIT_CARD");
    const id = await begin(card, "2026-03-31", 52_340n);
    expect(await state(id)).toMatchObject({ balance: "-52340" });
    expect((await listReconciliations(actor, card))[0]).toMatchObject({ id, statementBalanceCents: 52_340n, sign: -1 });
    expect((await getWorksheet(actor, id))?.statementLedgerCents).toBe(-52_340n);
  });

  it("refuses a date that does not exist, a balance out of range, and an account that is not a statement account", async () => {
    const bank = await account();
    const inactive = await account("BANK", { active: false });
    const foreign = await account("BANK", { company: W.companyB });
    expect(await refusal(startReconciliation(actor, { accountId: bank, statementDate: "2026-02-30", statementBalanceCents: 0n }))).toBe("banking.reconInvalid");
    expect(await refusal(startReconciliation(actor, { accountId: bank, statementDate: "2026-02-28", statementBalanceCents: 10n ** 15n }))).toBe("banking.reconInvalid");
    expect(await refusal(startReconciliation(actor, { accountId: "pas-un-id", statementDate: "2026-02-28", statementBalanceCents: 0n }))).toBe("banking.reconInvalid");
    for (const accountId of [W.sales, W.receivable, inactive, foreign, randomUUID()]) {
      expect(await refusal(startReconciliation(actor, { accountId, statementDate: "2026-02-28", statementBalanceCents: 0n }))).toBe("banking.account");
    }
    expect(await refusal(startReconciliation(reader, { accountId: bank, statementDate: "2026-02-28", statementBalanceCents: 0n }))).toBe("forbidden");
    expect(await count("bank_reconciliation WHERE account_id = $1", [bank])).toBe(0);
  });

  it("is one at a time on an account, even when two requests start together", async () => {
    const bank = await account();
    const other = await account();
    const outcomes = await Promise.allSettled([
      startReconciliation(actor, { accountId: bank, statementDate: "2026-03-31", statementBalanceCents: 0n }),
      startReconciliation(accountant, { accountId: bank, statementDate: "2026-04-30", statementBalanceCents: 0n }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const lost = outcomes.find((o) => o.status === "rejected");
    expect(lost && lost.status === "rejected" && lost.reason instanceof AppError && lost.reason.key).toBe("banking.reconInProgress");
    expect(await count("bank_reconciliation WHERE account_id = $1", [bank])).toBe(1);
    await begin(other, "2026-03-31", 0n); // another account is free
  });

  it("is for a day after the last statement completed on the account", async () => {
    const bank = await account();
    const first = await begin(bank, "2026-03-31", 0n);
    await completeReconciliation(actor, first);
    expect(await refusal(startReconciliation(actor, { accountId: bank, statementDate: "2026-03-31", statementBalanceCents: 0n }))).toBe("banking.reconDateOrder");
    expect(await refusal(startReconciliation(actor, { accountId: bank, statementDate: "2026-02-28", statementBalanceCents: 0n }))).toBe("banking.reconDateOrder");
    const second = await begin(bank, "2026-04-30", 0n);
    expect((await listAccountReconciliations(actor)).find((row) => row.accountId === bank)).toMatchObject({ inProgress: { id: second }, lastCompleted: { id: first, statementDate: "2026-03-31" } });
  });
});

describe("the worksheet", () => {
  it("lists the lines of the account up to the statement's day, with what each is matched to", async () => {
    const bank = await account();
    const elsewhere = await account();
    const sale = await post(bank, "2026-03-10", 10_000n, W.sales, "Vente");
    const fee = await post(bank, "2026-03-31", -300n, W.expenses, "Frais");
    await post(bank, "2026-04-01", 999n, W.sales, "Le lendemain");
    await post(elsewhere, "2026-03-10", 555n);
    const txn = await line(bank, "2026-03-10", 10_000n, "DEPOT");
    await matchTransaction(actor, txn, [sale.lineId]);
    const wrong = await post(bank, "2026-03-15", 700n, W.sales, "Erreur");
    const reversal = await reverseEntry(actor, wrong.entryId, { date: "2026-03-16" });
    const id = await begin(bank, "2026-03-31", 9_700n);
    const sheet = await getWorksheet(reader, id);
    expect(sheet).toMatchObject({ statementLedgerCents: 9_700n, previousCents: 0n, clearedCents: 0n, canReopen: false });
    expect(sheet?.lines.map((l) => [l.memo, l.cents, l.cleared])).toEqual([["Vente", 10_000n, false], ["Erreur", 700n, false], [null, -700n, false], ["Frais", -300n, false]]);
    expect(sheet?.lines[0]).toMatchObject({ lineId: sale.lineId, entryLabel: expect.stringMatching(/^J-\d{5}$/), entryDate: "2026-03-10", transaction: { id: txn, description: "DEPOT" }, reversed: false });
    expect(sheet?.lines[1]).toMatchObject({ reversed: true, transaction: null });
    expect(sheet?.lines[2]).toMatchObject({ reversed: true });
    expect(sheet?.lines[3]).toMatchObject({ lineId: fee.lineId });
    expect(reversal.number).toBeGreaterThan(0n);
    expect(await getWorksheet(otherOwner, id)).toBeNull();
    expect(await getWorksheet(actor, randomUUID())).toBeNull();
    expect(await getWorksheet(actor, "pas-un-id")).toBeNull();
  });
});

describe("ticking the lines", () => {
  it("saves exactly the lines that are ticked, and what is counted follows", async () => {
    const bank = await account();
    const a = await post(bank, "2026-03-05", 10_000n);
    const b = await post(bank, "2026-03-06", 2_500n);
    const c = await post(bank, "2026-03-07", -400n, W.expenses);
    const lastDay = await post(bank, "2026-03-31", 30n); // dated the statement's own day: counted
    const id = await begin(bank, "2026-03-31", 12_100n);
    await saveCleared(actor, id, [a.lineId, b.lineId]);
    expect(await ticked(id)).toEqual([a.lineId, b.lineId].sort());
    expect(await getWorksheet(actor, id)).toMatchObject({ clearedCents: 12_500n });
    await saveCleared(accountant, id, [b.lineId, c.lineId]); // a replaces, it does not add
    expect(await ticked(id)).toEqual([b.lineId, c.lineId].sort());
    const sheet = await getWorksheet(actor, id);
    expect(sheet?.clearedCents).toBe(2_100n);
    expect(sheet?.lines.filter((l) => l.cleared).map((l) => l.lineId).sort()).toEqual([b.lineId, c.lineId].sort());
    await saveCleared(actor, id, [lastDay.lineId]);
    expect(await ticked(id)).toEqual([lastDay.lineId]);
    await saveCleared(actor, id, []);
    expect(await ticked(id)).toEqual([]);
  });

  it("keeps exactly one of two saves that arrive together, never a mix of both", async () => {
    const bank = await account();
    const a = await post(bank, "2026-03-05", 100n);
    const b = await post(bank, "2026-03-06", 200n);
    const id = await begin(bank, "2026-03-31", 0n);
    await Promise.all([saveCleared(actor, id, [a.lineId]), saveCleared(accountant, id, [b.lineId])]);
    const kept = await ticked(id);
    expect(kept.length).toBe(1);
    expect([a.lineId, b.lineId]).toContain(kept[0]);
  });

  it("refuses a line of another account, one after the statement, one that does not exist, one another reconciliation counted, and too many", async () => {
    const bank = await account();
    const elsewhere = await account();
    const mine = await post(bank, "2026-03-05", 100n);
    const foreign = await post(elsewhere, "2026-03-05", 100n);
    const late = await post(bank, "2026-04-02", 100n);
    const earlier = await post(bank, "2026-02-10", 700n);
    const first = await begin(bank, "2026-02-28", 700n);
    await saveCleared(actor, first, [earlier.lineId]);
    await completeReconciliation(actor, first);
    const id = await begin(bank, "2026-03-31", 800n);
    expect(await refusal(saveCleared(actor, id, [foreign.lineId]))).toBe("banking.reconLine");
    expect(await refusal(saveCleared(actor, id, [randomUUID()]))).toBe("banking.reconLine");
    expect(await refusal(saveCleared(actor, id, [late.lineId]))).toBe("banking.reconLineLate");
    expect(await refusal(saveCleared(actor, id, [earlier.lineId]))).toBe("banking.reconLineTaken");
    expect(await refusal(saveCleared(actor, id, [mine.lineId, "pas-un-id"]))).toBe("banking.invalid");
    expect(await refusal(saveCleared(actor, id, Array.from({ length: 5001 }, () => randomUUID())))).toBe("banking.invalid");
    expect(await refusal(saveCleared(reader, id, [mine.lineId]))).toBe("forbidden");
    expect(await refusal(saveCleared(otherOwner, id, [mine.lineId]))).toBe("banking.reconciliationNotFound");
    expect(await ticked(id)).toEqual([]);
    await saveCleared(actor, id, [mine.lineId, mine.lineId]); // twice in the request is once
    expect(await ticked(id)).toEqual([mine.lineId]);
  });

  it("ticks every line a statement line is matched to, and only those, once", async () => {
    const bank = await account();
    const sale = await post(bank, "2026-03-05", 10_000n);
    const fee = await post(bank, "2026-03-05", -300n, W.expenses);
    const loose = await post(bank, "2026-03-06", 50n);
    const late = await post(bank, "2026-04-05", 70n);
    await matchTransaction(actor, await line(bank, "2026-03-05", 9_700n), [sale.lineId, fee.lineId]);
    await matchTransaction(actor, await line(bank, "2026-04-05", 70n), [late.lineId]);
    const id = await begin(bank, "2026-03-31", 9_700n);
    expect(await clearMatchedLines(accountant, id)).toBe(2);
    expect(await ticked(id)).toEqual([sale.lineId, fee.lineId].sort());
    expect((await getWorksheet(actor, id))?.lines.find((l) => l.lineId === loose.lineId)?.cleared).toBe(false);
    expect(await clearMatchedLines(actor, id)).toBe(0);
    expect(await refusal(clearMatchedLines(reader, id))).toBe("forbidden");
    expect(await refusal(clearMatchedLines(otherOwner, id))).toBe("banking.reconciliationNotFound");
    await completeReconciliation(actor, id);
  });
});

describe("completing a reconciliation", () => {
  it("is refused while the ticked lines are not the statement's balance, and then freezes it", async () => {
    const bank = await account();
    const a = await post(bank, "2026-03-05", 10_000n);
    const b = await post(bank, "2026-03-06", 2_500n);
    const id = await begin(bank, "2026-03-31", 12_500n);
    await saveCleared(actor, id, [a.lineId]);
    expect(await refusal(completeReconciliation(actor, id))).toBe("banking.reconDifference");
    expect(await refusal(completeReconciliation(reader, id))).toBe("forbidden");
    expect(await refusal(completeReconciliation(otherOwner, id))).toBe("banking.reconciliationNotFound");
    expect((await state(id)).status).toBe("IN_PROGRESS");
    await saveCleared(actor, id, [a.lineId, b.lineId]);
    await completeReconciliation(accountant, id);
    expect(await state(id)).toMatchObject({ status: "COMPLETED", completed_by_id: W.userAccountant });
    expect((await state(id)).completed_at).toBeInstanceOf(Date);
    expect(await getWorksheet(actor, id)).toMatchObject({ clearedCents: 12_500n, canReopen: true, reconciliation: { status: "COMPLETED" } });
    expect((await getWorksheet(actor, id))?.lines.map((l) => l.lineId).sort()).toEqual([a.lineId, b.lineId].sort());
    // frozen, for the service...
    for (const run of [() => saveCleared(actor, id, []), () => clearMatchedLines(actor, id), () => completeReconciliation(actor, id), () => discardReconciliation(actor, id)]) expect(await refusal(run())).toBe("banking.reconCompleted");
    expect(await ticked(id)).toHaveLength(2);
    // ...and for the database
    const c = await post(bank, "2026-03-08", 1n);
    await expect(db.query("INSERT INTO reconciled_line (id, company_id, reconciliation_id, journal_line_id) VALUES (gen_random_uuid(), $1, $2, $3)", [W.companyA, id, c.lineId])).rejects.toMatchObject({ code: "AL010" });
    await expect(db.query("DELETE FROM reconciled_line WHERE reconciliation_id = $1", [id])).rejects.toMatchObject({ code: "AL010" });
    await expect(db.query("DELETE FROM bank_reconciliation WHERE id = $1", [id])).rejects.toMatchObject({ code: "AL010" });
    await expect(db.query("UPDATE bank_reconciliation SET statement_balance_cents = 1 WHERE id = $1", [id])).rejects.toMatchObject({ code: "AL010" });
  });

  it("adds up from one statement to the next: the second counts what the first counted", async () => {
    const bank = await account();
    const first = await post(bank, "2026-03-10", 10_000n);
    const second = await post(bank, "2026-04-10", 1_500n);
    const one = await begin(bank, "2026-03-31", 10_000n);
    await saveCleared(actor, one, [first.lineId]);
    await completeReconciliation(actor, one);
    const two = await begin(bank, "2026-04-30", 11_500n);
    const sheet = await getWorksheet(actor, two);
    expect(sheet?.previousCents).toBe(10_000n);
    expect(sheet?.lines.map((l) => l.lineId)).toEqual([second.lineId]); // the first statement's line is not offered again
    expect(await refusal(completeReconciliation(actor, two))).toBe("banking.reconDifference"); // 10,000 only
    await saveCleared(actor, two, [second.lineId]);
    await completeReconciliation(actor, two);
    expect((await getWorksheet(actor, one))?.previousCents).toBe(0n); // the earlier one does not see the later one
    expect((await getWorksheet(actor, two))?.previousCents).toBe(10_000n);
    // a line dated before the last statement but entered after it is offered to the next one
    const forgotten = await post(bank, "2026-03-20", 200n);
    const three = await begin(bank, "2026-05-31", 11_700n);
    expect((await getWorksheet(actor, three))?.lines.map((l) => l.lineId)).toEqual([forgotten.lineId]);
    await saveCleared(actor, three, [forgotten.lineId]);
    await completeReconciliation(actor, three);
  });

  it("reconciles a card the way its statement reads: what is owed", async () => {
    const card = await account("CREDIT_CARD");
    const purchase = await post(card, "2026-03-05", -52_340n, W.expenses); // owed goes up: a credit to the card
    const payment = await post(card, "2026-03-20", 10_000n, W.expenses); // a payment: a debit
    const id = await begin(card, "2026-03-31", 42_340n);
    await saveCleared(actor, id, [purchase.lineId]);
    expect(await refusal(completeReconciliation(actor, id))).toBe("banking.reconDifference"); // 523,40 owed counted, 423,40 stated
    await saveCleared(actor, id, [purchase.lineId, payment.lineId]);
    await completeReconciliation(actor, id);
    expect((await getWorksheet(actor, id))?.reconciliation).toMatchObject({ statementBalanceCents: 42_340n, sign: -1 });
  });
});

describe("reopening and abandoning", () => {
  it("reopens the latest completed reconciliation with a written reason that the audit trail keeps", async () => {
    const bank = await account();
    const a = await post(bank, "2026-03-10", 100n);
    const b = await post(bank, "2026-04-10", 50n);
    const one = await begin(bank, "2026-03-31", 100n);
    await saveCleared(actor, one, [a.lineId]);
    await completeReconciliation(actor, one);
    const two = await begin(bank, "2026-04-30", 150n);
    // while another one is in progress, nothing is reopened
    expect(await refusal(reopenReconciliation(actor, one, "Une erreur de saisie à corriger"))).toBe("banking.reconInProgress");
    await saveCleared(actor, two, [b.lineId]);
    await completeReconciliation(actor, two);
    expect(await refusal(reopenReconciliation(actor, one, "Une erreur de saisie à corriger"))).toBe("banking.reconNotLatest");
    expect((await getWorksheet(actor, one))?.canReopen).toBe(false);
    expect(await refusal(reopenReconciliation(actor, two, "court"))).toBe("banking.reconReason");
    expect(await refusal(reopenReconciliation(reader, two, "Une erreur de saisie à corriger"))).toBe("forbidden");
    expect(await refusal(reopenReconciliation(otherOwner, two, "Une erreur de saisie à corriger"))).toBe("banking.reconciliationNotFound");
    expect(await refusal(reopenReconciliation(actor, randomUUID(), "Une erreur de saisie à corriger"))).toBe("banking.reconciliationNotFound");
    expect((await state(two)).status).toBe("COMPLETED");
    await reopenReconciliation(accountant, two, "Une ligne avait été oubliée au relevé");
    expect(await state(two)).toMatchObject({ status: "IN_PROGRESS", completed_at: null, completed_by_id: null });
    expect(await ticked(two)).toEqual([b.lineId]); // what was counted stays counted
    const audit = (await db.query("SELECT actor_user_id, after FROM audit_log WHERE action = 'bank_reconciliation.reopen' AND entity_id = $1", [two])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: W.userAccountant, after: expect.objectContaining({ reason: "Une ligne avait été oubliée au relevé", statementDate: "2026-04-30" }) });
    expect(await refusal(reopenReconciliation(actor, two, "Une erreur de saisie à corriger"))).toBe("banking.reconNotCompleted");
    // reopened, it is edited and completed again; the earlier one stays frozen
    const c = await post(bank, "2026-04-12", 25n);
    await saveCleared(actor, two, [b.lineId, c.lineId]);
    expect(await refusal(completeReconciliation(actor, two))).toBe("banking.reconDifference");
    await saveCleared(actor, two, [b.lineId]);
    await completeReconciliation(actor, two);
    expect((await state(one)).status).toBe("COMPLETED");
  });

  it("abandons one in progress, its ticks with it, and never one that is completed", async () => {
    const bank = await account();
    const a = await post(bank, "2026-03-10", 100n);
    const id = await begin(bank, "2026-03-31", 100n);
    await saveCleared(actor, id, [a.lineId]);
    expect(await refusal(discardReconciliation(reader, id))).toBe("forbidden");
    expect(await refusal(discardReconciliation(otherOwner, id))).toBe("banking.reconciliationNotFound");
    await discardReconciliation(accountant, id);
    expect(await count("bank_reconciliation WHERE id = $1", [id])).toBe(0);
    expect(await count("reconciled_line WHERE journal_line_id = $1", [a.lineId])).toBe(0);
    expect(await getWorksheet(actor, id)).toBeNull();
    // the line is free for the next one, and a new reconciliation can start
    const next = await begin(bank, "2026-03-31", 100n);
    await saveCleared(actor, next, [a.lineId]);
    await completeReconciliation(actor, next);
    expect(await refusal(discardReconciliation(actor, next))).toBe("banking.reconCompleted");
  });
});

describe("the database's own rules on reconciliations", () => {
  it("refuses a line of another account or after the statement, a second one in progress, a wrong balance and reopening an older one", async () => {
    const bank = await account();
    const elsewhere = await account();
    const own = await post(bank, "2026-03-10", 100n);
    const foreign = await post(elsewhere, "2026-03-10", 100n);
    const late = await post(bank, "2026-04-10", 100n);
    const insert = (rec: string, lineId: string) => db.query("INSERT INTO reconciled_line (id, company_id, reconciliation_id, journal_line_id) VALUES (gen_random_uuid(), $1, $2, $3)", [W.companyA, rec, lineId]);
    const make = async (date: string, balance: number) => {
      const id = randomUUID();
      await db.query("INSERT INTO bank_reconciliation (id, company_id, account_id, statement_date, statement_balance_cents, created_by_id) VALUES ($1, $2, $3, $4, $5, $6)", [id, W.companyA, bank, date, balance, W.userOwnerA]);
      return id;
    };
    const one = await make("2026-03-31", 100);
    await expect(insert(one, foreign.lineId)).rejects.toMatchObject({ code: "AL010" });
    await expect(insert(one, late.lineId)).rejects.toMatchObject({ code: "AL010" });
    await expect(make("2026-04-30", 0)).rejects.toMatchObject({ code: "23505" }); // one in progress per account
    await expect(db.query("UPDATE bank_reconciliation SET status = 'COMPLETED', completed_at = now(), completed_by_id = $2 WHERE id = $1", [one, W.userOwnerA])).rejects.toMatchObject({ code: "AL010" }); // nothing counted yet
    await insert(one, own.lineId);
    await db.query("UPDATE bank_reconciliation SET status = 'COMPLETED', completed_at = now(), completed_by_id = $2 WHERE id = $1", [one, W.userOwnerA]);
    const two = await make("2026-04-30", 200);
    await insert(two, late.lineId);
    await db.query("UPDATE bank_reconciliation SET status = 'COMPLETED', completed_at = now(), completed_by_id = $2 WHERE id = $1", [two, W.userOwnerA]);
    await expect(db.query("UPDATE bank_reconciliation SET status = 'IN_PROGRESS', completed_at = NULL, completed_by_id = NULL WHERE id = $1", [one])).rejects.toMatchObject({ code: "AL010" });
    await expect(inTransaction(async () => { await make("2026-04-15", 0); })).rejects.toMatchObject({ code: "AL010" }); // a day before the last completed
  });
});
