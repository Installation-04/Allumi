import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categorizeTransaction, createTransfer, getBankTransaction, listBankTransactions, listMatchCandidates, listTransferCandidates, matchTransaction, setTransactionStatus, unmatchTransaction } from "@/modules/banking";
import { lockPeriod, postManualEntry, reverseEntry } from "@/modules/ledger";
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
async function account(subtype = "BANK"): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO account (id, company_id, code, name_fr, name_en, type, subtype, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7::account_subtype, now())", [
    id, W.companyA, `17${String(++accountCounter).padStart(2, "0")}`, `Compte ${accountCounter}`, `Account ${accountCounter}`, subtype === "CREDIT_CARD" ? "LIABILITY" : "ASSET", subtype,
  ]);
  return id;
}

/** A statement line, as an import leaves it. */
async function line(accountId: string, date: string, cents: bigint, description = "Ligne de relevé", currency = "CAD"): Promise<string> {
  const id = randomUUID();
  await db.query(
    "INSERT INTO bank_transaction (id, company_id, account_id, txn_date, amount_cents, description, dedupe_key, currency, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())",
    [id, W.companyA, accountId, date, cents.toString(), description, `test:${id}`, currency],
  );
  return id;
}

/** A manual entry that moves `cents` on the account against `against`: positive is money in (a debit). Returns the ids of its lines. */
async function post(accountId: string, date: string, cents: bigint, against: string = W.sales, memo: string | null = "Écriture"): Promise<{ entryId: string; lineId: string; number: bigint }> {
  const abs = cents < 0n ? -cents : cents;
  const entry = await postManualEntry(actor, {
    date, kind: "MANUAL", memo,
    lines: [
      { accountId, debitCents: cents > 0n ? abs : 0n, creditCents: cents < 0n ? abs : 0n },
      { accountId: against, debitCents: cents < 0n ? abs : 0n, creditCents: cents > 0n ? abs : 0n },
    ],
  });
  const lines = (await db.query("SELECT id FROM journal_line WHERE entry_id = $1 AND account_id = $2", [entry.id, accountId])).rows;
  return { entryId: entry.id, lineId: lines[0].id as string, number: entry.number };
}

async function inTransaction(run: () => Promise<void>) {
  await db.query("BEGIN");
  try { await run(); await db.query("COMMIT"); } catch (error) { await db.query("ROLLBACK"); throw error; }
}
const status = async (id: string) => (await db.query("SELECT status FROM bank_transaction WHERE id = $1", [id])).rows[0].status as string;
const matchesOf = async (id: string) => (await db.query("SELECT journal_line_id FROM bank_match WHERE bank_transaction_id = $1 ORDER BY journal_line_id", [id])).rows.map((row) => row.journal_line_id as string);

describe("matching a transaction to ledger lines", () => {
  it("matches one line of the same amount, and shows it on the transaction", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-03-10", 10_000n, "Dépôt client");
    const entry = await post(bank, "2026-03-09", 10_000n);
    await matchTransaction(actor, txn, [entry.lineId]);
    expect(await status(txn)).toBe("MATCHED");
    expect(await matchesOf(txn)).toEqual([entry.lineId]);
    const shown = await getBankTransaction(reader, txn);
    expect(shown?.status).toBe("MATCHED");
    expect(shown?.matches).toEqual([expect.objectContaining({ lineId: entry.lineId, entryId: entry.entryId, entryNumber: entry.number, entryLabel: expect.stringMatching(/^J-\d{5}$/), entryDate: "2026-03-09", sourceType: "MANUAL", cents: 10_000n, reversed: false, reconciled: false })]);
    expect(shown?.suggestion).toBeNull();
  });

  it("matches several lines that together make the amount, a fee included", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-03-12", 14_700n, "Dépôt Stripe");
    const gross = await post(bank, "2026-03-11", 15_000n);
    const fee = await post(bank, "2026-03-11", -300n, W.expenses);
    await matchTransaction(accountant, txn, [fee.lineId, gross.lineId]);
    expect(await matchesOf(txn)).toEqual([fee.lineId, gross.lineId].sort());
    expect((await getBankTransaction(actor, txn))?.matches.map((m) => m.cents)).toEqual([15_000n, -300n]);
  });

  it("refuses lines that do not add up to the amount, and says nothing was changed", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-03-10", 10_000n);
    const near = await post(bank, "2026-03-10", 9_999n);
    expect(await refusal(matchTransaction(actor, txn, [near.lineId]))).toBe("banking.sumMismatch");
    expect(await refusal(matchTransaction(actor, txn, []))).toBe("banking.noLines");
    expect(await status(txn)).toBe("UNMATCHED");
    expect(await matchesOf(txn)).toEqual([]);
  });

  it("refuses a line twice in the request, a line that does not exist, one of another account and one of another company", async () => {
    const bank = await account();
    const elsewhere = await account();
    const txn = await line(bank, "2026-03-10", 500n);
    const mine = await post(bank, "2026-03-10", 500n);
    const foreign = await post(elsewhere, "2026-03-10", 500n);
    expect(await refusal(matchTransaction(actor, txn, [mine.lineId, mine.lineId]))).toBe("banking.invalid");
    expect(await refusal(matchTransaction(actor, txn, [randomUUID()]))).toBe("banking.lineNotFound");
    expect(await refusal(matchTransaction(actor, txn, [foreign.lineId]))).toBe("banking.lineNotFound");
    expect(await refusal(matchTransaction(otherOwner, txn, [mine.lineId]))).toBe("banking.transactionNotFound");
    expect(await refusal(matchTransaction(actor, "pas-un-id", [mine.lineId]))).toBe("banking.invalid");
    expect(await refusal(matchTransaction(actor, txn, Array.from({ length: 22 }, () => randomUUID())))).toBe("banking.invalid");
    expect(await status(txn)).toBe("UNMATCHED");
  });

  it("refuses more lines than a statement line can be", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-03-10", 2_100n);
    const entry = await postManualEntry(actor, {
      date: "2026-03-10", kind: "MANUAL", memo: "21 chèques",
      lines: [...Array.from({ length: 21 }, () => ({ accountId: bank, debitCents: 100n, creditCents: 0n })), { accountId: W.sales, debitCents: 0n, creditCents: 2_100n }],
    });
    const ids = (await db.query("SELECT id FROM journal_line WHERE entry_id = $1 AND account_id = $2", [entry.id, bank])).rows.map((row) => row.id as string);
    expect(ids).toHaveLength(21);
    expect(await refusal(matchTransaction(actor, txn, ids))).toBe("banking.tooManyLines");
  });

  it("refuses a transaction that is not waiting: matched, set aside, or in another currency", async () => {
    const bank = await account();
    const a = await post(bank, "2026-03-10", 700n);
    const b = await post(bank, "2026-03-10", 700n);
    const matched = await line(bank, "2026-03-10", 700n);
    await matchTransaction(actor, matched, [a.lineId]);
    expect(await refusal(matchTransaction(actor, matched, [b.lineId]))).toBe("banking.notUnmatched");
    const aside = await line(bank, "2026-03-10", 700n);
    await setTransactionStatus(actor, aside, "EXCLUDED");
    expect(await refusal(matchTransaction(actor, aside, [b.lineId]))).toBe("banking.notUnmatched");
    const usd = await line(bank, "2026-03-10", 700n, "Achat en dollars US", "USD");
    expect(await refusal(matchTransaction(actor, usd, [b.lineId]))).toBe("banking.currency");
  });

  it("matches a ledger line to one transaction only, even when two requests race for it", async () => {
    const bank = await account();
    const entry = await post(bank, "2026-03-10", 4_200n);
    const first = await line(bank, "2026-03-10", 4_200n, "A");
    const second = await line(bank, "2026-03-10", 4_200n, "B");
    const third = await line(bank, "2026-03-10", 4_200n, "C");
    const outcomes = await Promise.allSettled([matchTransaction(actor, first, [entry.lineId]), matchTransaction(actor, second, [entry.lineId])]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const lost = outcomes.find((o) => o.status === "rejected");
    expect(lost && lost.status === "rejected" && lost.reason instanceof AppError && lost.reason.key).toBe("banking.lineTaken");
    expect(await count("bank_match WHERE journal_line_id = $1", [entry.lineId])).toBe(1);
    const statuses = [await status(first), await status(second)].sort();
    expect(statuses).toEqual(["MATCHED", "UNMATCHED"]);
    // and later, when the winner has long committed
    expect(await refusal(matchTransaction(actor, third, [entry.lineId]))).toBe("banking.lineTaken");
    expect(await status(third)).toBe("UNMATCHED");
  });

  it("matches a transaction once when two requests ask for it with different lines at the same time", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-03-10", 800n);
    const one = await post(bank, "2026-03-10", 800n);
    const two = await post(bank, "2026-03-10", 800n);
    const outcomes = await Promise.allSettled([matchTransaction(actor, txn, [one.lineId]), matchTransaction(actor, txn, [two.lineId])]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const lost = outcomes.find((o) => o.status === "rejected");
    expect(lost && lost.status === "rejected" && lost.reason instanceof AppError && lost.reason.key).toBe("banking.notUnmatched");
    expect(await matchesOf(txn)).toHaveLength(1);
    expect(await status(txn)).toBe("MATCHED");
  });

  it("records a transaction once when two requests ask for it at the same time", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-03-10", -800n, "Deux clics");
    const outcomes = await Promise.allSettled([categorizeTransaction(actor, txn, { accountId: W.expenses }), categorizeTransaction(accountant, txn, { accountId: W.sales })]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const lost = outcomes.find((o) => o.status === "rejected");
    expect(lost && lost.status === "rejected" && lost.reason instanceof AppError && lost.reason.key).toBe("banking.notUnmatched");
    expect(await count("journal_entry WHERE source_type = 'BANK' AND source_id = $1", [txn])).toBe(1);
  });

  it("is for the owner and the accountant, not for a member who only reads", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-03-10", 100n);
    const entry = await post(bank, "2026-03-10", 100n);
    expect(await refusal(matchTransaction(reader, txn, [entry.lineId]))).toBe("forbidden");
    expect(await refusal(unmatchTransaction(reader, txn))).toBe("forbidden");
    expect(await refusal(categorizeTransaction(reader, txn, { accountId: W.sales }))).toBe("forbidden");
    expect(await status(txn)).toBe("UNMATCHED");
  });
});

describe("undoing a match", () => {
  it("frees the transaction and its lines for another match", async () => {
    const bank = await account();
    const entry = await post(bank, "2026-03-10", 3_000n);
    const first = await line(bank, "2026-03-10", 3_000n, "Première");
    const second = await line(bank, "2026-03-10", 3_000n, "Deuxième");
    await matchTransaction(actor, first, [entry.lineId]);
    await unmatchTransaction(accountant, first);
    expect(await status(first)).toBe("UNMATCHED");
    expect(await matchesOf(first)).toEqual([]);
    await matchTransaction(actor, second, [entry.lineId]);
    expect(await matchesOf(second)).toEqual([entry.lineId]);
  });

  it("refuses a transaction that is not matched, or that is not there", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-03-10", 3_000n);
    expect(await refusal(unmatchTransaction(actor, txn))).toBe("banking.notMatched");
    expect(await refusal(unmatchTransaction(otherOwner, txn))).toBe("banking.transactionNotFound");
    expect(await refusal(unmatchTransaction(actor, "pas-un-id"))).toBe("banking.transactionNotFound");
  });

  it("refuses while a completed reconciliation counts one of the lines, in the service and in the database", async () => {
    const bank = await account();
    const entry = await post(bank, "2026-03-10", 3_000n);
    const txn = await line(bank, "2026-03-10", 3_000n);
    await matchTransaction(actor, txn, [entry.lineId]);
    const reconciliation = randomUUID();
    await db.query("INSERT INTO bank_reconciliation (id, company_id, account_id, statement_date, statement_balance_cents, status, created_by_id) VALUES ($1, $2, $3, '2026-03-31', 3000, 'IN_PROGRESS', $4)", [reconciliation, W.companyA, bank, W.userOwnerA]);
    await db.query("INSERT INTO reconciled_line (id, company_id, reconciliation_id, journal_line_id) VALUES (gen_random_uuid(), $1, $2, $3)", [W.companyA, reconciliation, entry.lineId]);
    // a reconciliation in progress is work: the match can still be undone, and done again
    expect((await getBankTransaction(actor, txn))?.matches[0]?.reconciled).toBe(false);
    await unmatchTransaction(actor, txn);
    await matchTransaction(actor, txn, [entry.lineId]);
    // completed, it is the statement's proof
    await db.query("UPDATE bank_reconciliation SET status = 'COMPLETED', completed_at = now(), completed_by_id = $2 WHERE id = $1", [reconciliation, W.userOwnerA]);
    expect((await getBankTransaction(actor, txn))?.matches[0]?.reconciled).toBe(true);
    expect(await refusal(unmatchTransaction(actor, txn))).toBe("banking.lineReconciled");
    expect(await status(txn)).toBe("MATCHED");
    // the database says the same to anything that goes around the service
    // (a complete undo: the match goes and the transaction waits again, so nothing but this rule can refuse it)
    await expect(inTransaction(async () => {
      await db.query("DELETE FROM bank_match WHERE bank_transaction_id = $1", [txn]);
      await db.query("UPDATE bank_transaction SET status = 'UNMATCHED' WHERE id = $1", [txn]);
    })).rejects.toMatchObject({ code: "AL010", message: expect.stringContaining("completed reconciliation") });
    expect(await status(txn)).toBe("MATCHED");
    // reopened, the match can be undone
    await db.query("UPDATE bank_reconciliation SET status = 'IN_PROGRESS', completed_at = NULL, completed_by_id = NULL WHERE id = $1", [reconciliation]);
    await unmatchTransaction(actor, txn);
    expect(await status(txn)).toBe("UNMATCHED");
  });
});

describe("recording a transaction against another account", () => {
  it("makes the entry for money going out: credit to the statement's account, debit to the other, dated like the line", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-04-02", -4_599n, "SAAQ Immatriculation");
    const result = await categorizeTransaction(accountant, txn, { accountId: W.expenses });
    expect(await status(txn)).toBe("MATCHED");
    const entry = (await db.query("SELECT id, entry_number::text AS number, entry_date::text AS d, source_type, source_id, memo, created_by_id FROM journal_entry WHERE id = $1", [result.entryId])).rows[0];
    expect(entry).toMatchObject({ number: result.entryNumber.toString(), d: "2026-04-02", source_type: "BANK", source_id: txn, memo: "SAAQ Immatriculation", created_by_id: W.userAccountant });
    const lines = (await db.query("SELECT id, account_id, debit_cents::text AS debit, credit_cents::text AS credit, description FROM journal_line WHERE entry_id = $1 ORDER BY line_no", [result.entryId])).rows;
    expect(lines).toEqual([
      expect.objectContaining({ account_id: bank, debit: "0", credit: "4599", description: "SAAQ Immatriculation" }),
      expect.objectContaining({ account_id: W.expenses, debit: "4599", credit: "0" }),
    ]);
    expect(await matchesOf(txn)).toEqual([lines[0].id]);
  });

  it("makes the entry for money coming in, with the memo it is given", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-04-03", 25_000n, "VIREMENT INTERAC");
    const result = await categorizeTransaction(actor, txn, { accountId: W.sales, memo: "  Vente comptoir  " });
    const lines = (await db.query("SELECT account_id, debit_cents::text AS debit, credit_cents::text AS credit FROM journal_line WHERE entry_id = $1 ORDER BY line_no", [result.entryId])).rows;
    expect(lines).toEqual([{ account_id: bank, debit: "25000", credit: "0" }, { account_id: W.sales, debit: "0", credit: "25000" }]);
    expect((await db.query("SELECT memo FROM journal_entry WHERE id = $1", [result.entryId])).rows[0].memo).toBe("Vente comptoir");
  });

  it("refuses the same account, an account entries cannot be posted to, and a transaction that is not waiting", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-04-02", -100n);
    expect(await refusal(categorizeTransaction(actor, txn, { accountId: bank }))).toBe("banking.sameAccount");
    expect(await refusal(categorizeTransaction(actor, txn, { accountId: W.receivable }))).toBe("ledger.accountNotAllowed");
    expect(await refusal(categorizeTransaction(actor, txn, { accountId: randomUUID() }))).toBe("ledger.accountNotAllowed");
    expect(await refusal(categorizeTransaction(actor, txn, { accountId: "pas-un-id" }))).toBe("banking.invalid");
    expect(await refusal(categorizeTransaction(otherOwner, txn, { accountId: W.expenses }))).toBe("banking.transactionNotFound");
    expect(await count("journal_entry WHERE source_type = 'BANK' AND source_id = $1", [txn])).toBe(0);
    expect(await status(txn)).toBe("UNMATCHED");
    await categorizeTransaction(actor, txn, { accountId: W.expenses });
    expect(await refusal(categorizeTransaction(actor, txn, { accountId: W.expenses }))).toBe("banking.notUnmatched");
    const usd = await line(bank, "2026-04-02", -100n, "En dollars US", "USD");
    expect(await refusal(categorizeTransaction(actor, usd, { accountId: W.expenses }))).toBe("banking.currency");
  });

  it("refuses to count the same money twice: an entry already stands for the line until it is reversed", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-04-05", -2_000n, "Papeterie");
    const first = await categorizeTransaction(actor, txn, { accountId: W.expenses });
    await unmatchTransaction(actor, txn);
    expect(await refusal(categorizeTransaction(actor, txn, { accountId: W.expenses }))).toBe("banking.alreadyRecorded");
    // the entry is still there to match
    const entryLine = (await db.query("SELECT id FROM journal_line WHERE entry_id = $1 AND account_id = $2", [first.entryId, bank])).rows[0].id as string;
    expect((await listMatchCandidates(actor, txn)).map((c) => c.lineId)).toContain(entryLine);
    // a wrong entry is corrected the way every entry is: by reversing it, and the line can be recorded again
    await reverseEntry(actor, first.entryId, { date: "2026-04-06" });
    const second = await categorizeTransaction(actor, txn, { accountId: W.sales });
    expect(second.entryId).not.toBe(first.entryId);
    expect(await count("journal_entry WHERE source_type = 'BANK' AND source_id = $1", [txn])).toBe(2);
  });

  it("is refused in a locked period, with nothing recorded", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-02-14", -800n, "Février");
    const period = (await db.query("SELECT id FROM fiscal_period WHERE company_id = $1 AND start_date = '2026-02-01'", [W.companyA])).rows[0].id as string;
    await lockPeriod(actor, period);
    try {
      expect(await refusal(categorizeTransaction(actor, txn, { accountId: W.expenses }))).toMatch(/^(AL\d{3}|ledger\.\w+)$/);
      expect(await count("journal_entry WHERE source_type = 'BANK' AND source_id = $1", [txn])).toBe(0);
      expect(await status(txn)).toBe("UNMATCHED");
    } finally {
      await db.query("UPDATE fiscal_period SET status = 'OPEN', locked_at = NULL, locked_by_id = NULL WHERE id = $1", [period]);
    }
  });
});

describe("recording a transfer between two accounts", () => {
  it("makes one entry with a line on each account, dated the earlier day, and matches each line to its own", async () => {
    const chequing = await account();
    const card = await account("CREDIT_CARD");
    const out = await line(chequing, "2026-05-10", -50_000n, "PAIEMENT CARTE");
    const into = await line(card, "2026-05-12", 50_000n, "PAIEMENT RECU");
    const result = await createTransfer(accountant, { transactionId: out, otherTransactionId: into, memo: "Paiement de la carte" });
    expect(await status(out)).toBe("MATCHED");
    expect(await status(into)).toBe("MATCHED");
    const entry = (await db.query("SELECT entry_date::text AS d, source_type, source_id, memo FROM journal_entry WHERE id = $1", [result.entryId])).rows[0];
    expect(entry).toMatchObject({ d: "2026-05-10", source_type: "BANK", source_id: out, memo: "Paiement de la carte" });
    const lines = (await db.query("SELECT id, account_id, debit_cents::text AS debit, credit_cents::text AS credit FROM journal_line WHERE entry_id = $1", [result.entryId])).rows;
    const on = (id: string) => lines.find((row) => row.account_id === id);
    expect(on(chequing)).toMatchObject({ debit: "0", credit: "50000" });
    expect(on(card)).toMatchObject({ debit: "50000", credit: "0" });
    expect(await matchesOf(out)).toEqual([on(chequing).id]);
    expect(await matchesOf(into)).toEqual([on(card).id]);
  });

  it("finds the other side: another account, the opposite amount, within a week, the closest first", async () => {
    const chequing = await account();
    const savings = await account();
    const out = await line(chequing, "2026-05-10", -1_000_000n, "VIREMENT");
    const far = await line(savings, "2026-05-18", 1_000_000n, "Trop loin");
    const near = await line(savings, "2026-05-11", 1_000_000n, "Le bon");
    const nearer = await line(savings, "2026-05-10", 1_000_000n, "Le meilleur");
    await line(savings, "2026-05-11", 999_999n, "Autre montant");
    await line(chequing, "2026-05-11", 1_000_000n, "Même compte");
    const matched = await line(savings, "2026-05-10", 1_000_000n, "Déjà apparié");
    await setTransactionStatus(actor, matched, "EXCLUDED");
    expect((await listTransferCandidates(reader, out)).map((c) => c.id)).toEqual([nearer, near]);
    expect((await listTransferCandidates(actor, far)).map((c) => c.id)).toEqual([]);
    expect(await refusal(listTransferCandidates(otherOwner, out))).toBe("banking.transactionNotFound");
  });

  it("refuses the same account, amounts that do not cancel, the same line twice and lines that are not waiting", async () => {
    const a = await account();
    const b = await account();
    const out = await line(a, "2026-05-10", -300n);
    const sameAccount = await line(a, "2026-05-10", 300n);
    const wrongAmount = await line(b, "2026-05-10", 301n);
    const sameSign = await line(b, "2026-05-10", -300n);
    const good = await line(b, "2026-05-10", 300n);
    expect(await refusal(createTransfer(actor, { transactionId: out, otherTransactionId: sameAccount }))).toBe("banking.transferAccount");
    expect(await refusal(createTransfer(actor, { transactionId: out, otherTransactionId: wrongAmount }))).toBe("banking.transferAmounts");
    expect(await refusal(createTransfer(actor, { transactionId: out, otherTransactionId: sameSign }))).toBe("banking.transferAmounts");
    expect(await refusal(createTransfer(actor, { transactionId: out, otherTransactionId: out }))).toBe("banking.invalid");
    expect(await refusal(createTransfer(actor, { transactionId: out, otherTransactionId: randomUUID() }))).toBe("banking.transactionNotFound");
    expect(await refusal(createTransfer(reader, { transactionId: out, otherTransactionId: good }))).toBe("forbidden");
    expect(await count("journal_entry WHERE source_type = 'BANK' AND source_id = $1", [out])).toBe(0);
    // an entry already stands for the line (made with "record"): the transfer would count it twice
    const recorded = await line(a, "2026-05-10", -300n, "Déjà saisi");
    await categorizeTransaction(actor, recorded, { accountId: W.expenses });
    await unmatchTransaction(actor, recorded);
    expect(await refusal(createTransfer(actor, { transactionId: good, otherTransactionId: recorded }))).toBe("banking.alreadyRecorded");
    expect(await refusal(createTransfer(actor, { transactionId: recorded, otherTransactionId: good }))).toBe("banking.alreadyRecorded");
    await createTransfer(actor, { transactionId: out, otherTransactionId: good });
    const again = await line(b, "2026-05-10", 300n);
    expect(await refusal(createTransfer(actor, { transactionId: out, otherTransactionId: again }))).toBe("banking.notUnmatched");
  });

  it("records a transfer once when two requests ask for it at the same time", async () => {
    const a = await account();
    const b = await account();
    const out = await line(a, "2026-05-10", -9_900n);
    const into = await line(b, "2026-05-10", 9_900n);
    const outcomes = await Promise.allSettled([
      createTransfer(actor, { transactionId: out, otherTransactionId: into }),
      createTransfer(actor, { transactionId: into, otherTransactionId: out }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await count("journal_entry WHERE source_type = 'BANK' AND source_id IN ($1, $2)", [out, into])).toBe(1);
    expect(await count("bank_match WHERE bank_transaction_id IN ($1, $2)", [out, into])).toBe(2);
  });
});

describe("what the list suggests and what the candidates are", () => {
  it("suggests the line of the same amount nearest in date, within a week, and nothing else", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-06-10", 7_700n, "Dépôt");
    await post(bank, "2026-06-03", 7_700n);
    const nearer = await post(bank, "2026-06-12", 7_700n);
    await post(bank, "2026-06-10", 7_701n);
    await post(bank, "2026-06-18", 7_700n);
    // same figure the other way, and the same amount on another account, both on the day itself
    await post(bank, "2026-06-10", -7_700n, W.expenses);
    await post(await account(), "2026-06-10", 7_700n);
    const listed = (await listBankTransactions(reader, { accountId: bank })).transactions.find((t) => t.id === txn);
    expect(listed?.suggestion).toMatchObject({ lineId: nearer.lineId, entryNumber: nearer.number, cents: 7_700n });
    // seven days is near enough, eight is not
    const lonely = await line(bank, "2026-06-30", 123n, "Seul");
    await post(bank, "2026-07-08", 123n);
    const edge = await line(bank, "2026-06-20", 124n, "Au bord");
    const seventh = await post(bank, "2026-06-27", 124n);
    const all = (await listBankTransactions(reader, { accountId: bank })).transactions;
    expect(all.find((t) => t.id === lonely)?.suggestion).toBeNull();
    expect(all.find((t) => t.id === edge)?.suggestion).toMatchObject({ lineId: seventh.lineId });
  });

  it("does not suggest a line already matched, one that was reversed, or a reversal", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-06-10", 5_500n);
    const taken = await post(bank, "2026-06-10", 5_500n);
    const other = await line(bank, "2026-06-10", 5_500n, "Autre");
    await matchTransaction(actor, other, [taken.lineId]);
    // money out that was cancelled: its reversal puts the same 5500 back on the account, but is not a payment
    const wrong = await post(bank, "2026-06-10", -5_500n, W.expenses);
    await reverseEntry(actor, wrong.entryId, { date: "2026-06-10" });
    const listed = (await listBankTransactions(actor, { accountId: bank })).transactions;
    expect(listed.find((t) => t.id === txn)?.suggestion).toBeNull();
    expect(listed.find((t) => t.id === other)?.suggestion).toBeNull();
    expect(listed.find((t) => t.id === other)?.matches).toHaveLength(1);
  });

  it("lists the lines that could be the transaction, closest first, with the matched ones left out", async () => {
    const bank = await account();
    const txn = await line(bank, "2026-07-15", 1_000n);
    const far = await post(bank, "2026-05-01", 1_000n);
    const day = await post(bank, "2026-07-16", -2_000n, W.expenses);
    const same = await post(bank, "2026-07-15", 1_000n);
    const used = await post(bank, "2026-07-15", 1_000n);
    await matchTransaction(actor, await line(bank, "2026-07-15", 1_000n, "Prise"), [used.lineId]);
    const reversed = await post(bank, "2026-07-14", 400n);
    await reverseEntry(actor, reversed.entryId, { date: "2026-07-14" });
    const candidates = await listMatchCandidates(reader, txn);
    expect(candidates.map((c) => c.lineId)).not.toContain(used.lineId);
    expect(candidates.map((c) => c.lineId)).not.toContain(far.lineId);
    expect(candidates[0]).toMatchObject({ lineId: same.lineId, cents: 1_000n, reversed: false, reconciled: false });
    expect(candidates.find((c) => c.lineId === day.lineId)).toMatchObject({ cents: -2_000n });
    expect(candidates.filter((c) => c.reversed)).toHaveLength(2);
    // a wider window brings the far one back
    expect((await listMatchCandidates(reader, txn, { days: 90 })).map((c) => c.lineId)).toContain(far.lineId);
    expect(await refusal(listMatchCandidates(otherOwner, txn))).toBe("banking.transactionNotFound");
  });
});

describe("the database's own rules on matches", () => {
  const insertMatch = (txn: string, lineId: string) => db.query("INSERT INTO bank_match (id, company_id, bank_transaction_id, journal_line_id) VALUES (gen_random_uuid(), $1, $2, $3)", [W.companyA, txn, lineId]);

  it("refuses a sum that is not the transaction's, a line on another account, and a match on a transaction that is not matched", async () => {
    const bank = await account();
    const elsewhere = await account();
    const txn = await line(bank, "2026-08-01", 1_000n);
    const wrong = await post(bank, "2026-08-01", 999n);
    const foreign = await post(elsewhere, "2026-08-01", 1_000n);
    await expect(inTransaction(async () => {
      await insertMatch(txn, wrong.lineId);
      await db.query("UPDATE bank_transaction SET status = 'MATCHED' WHERE id = $1", [txn]);
    })).rejects.toMatchObject({ code: "AL010" });
    await expect(inTransaction(async () => {
      await insertMatch(txn, foreign.lineId);
      await db.query("UPDATE bank_transaction SET status = 'MATCHED' WHERE id = $1", [txn]);
    })).rejects.toMatchObject({ code: "AL010" });
    await expect(inTransaction(async () => { await insertMatch(txn, wrong.lineId); })).rejects.toMatchObject({ code: "AL010" });
    await expect(inTransaction(async () => { await db.query("UPDATE bank_transaction SET status = 'MATCHED' WHERE id = $1", [txn]); })).rejects.toMatchObject({ code: "AL010" });
    expect(await status(txn)).toBe("UNMATCHED");
    expect(await count("bank_match WHERE bank_transaction_id = $1", [txn])).toBe(0);
  });

  it("refuses an entry that claims to come from a bank line which does not exist", async () => {
    const bank = await account();
    await expect(inTransaction(async () => {
      const id = randomUUID();
      await db.query("INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, source_id, created_by_id) SELECT $1, $2, 90000 + floor(random() * 9000)::int, '2026-08-01', id, 'BANK', $3, $4 FROM fiscal_period WHERE company_id = $2 AND start_date = '2026-08-01'", [id, W.companyA, randomUUID(), W.userOwnerA]);
      await db.query("INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, entry_date) VALUES (gen_random_uuid(), $1, $2, 1, $3, 100, 0, '2026-08-01'), (gen_random_uuid(), $1, $2, 2, $4, 0, 100, '2026-08-01')", [W.companyA, id, bank, W.sales]);
    })).rejects.toMatchObject({ code: "AL010" });
  });
});
