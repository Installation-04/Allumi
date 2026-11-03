import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  recordDeposit,
  voidDeposit,
  getDeposit,
  listDeposits,
  listPendingDepositReceipts,
  recordReceipt,
  voidReceipt,
  getReceipt,
} from "@/modules/payments";
import {
  saveDraft,
  getDraft,
  postInvoice,
  getInvoiceOpenCents,
} from "@/modules/sales";
import { createDepositEntry, lockPeriod } from "@/modules/ledger";
import {
  matchTransaction,
  unmatchTransaction,
  startReconciliation,
  saveCleared,
} from "@/modules/banking";
import type { CompanyContext } from "@/platform/tenant";
import { withCompany } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld, W, appClient, setContext } from "./world";
const actor = { companyId: W.companyA, userId: W.userOwnerA };
const reader = { ...actor, userId: W.userReader };
const accountant = { ...actor, userId: W.userAccountant };
const other = { companyId: W.companyB, userId: W.userOwnerB };
let db: pg.Client;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query(
    "INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'PAYMENT_RECEIVED',1,'E-',5),($1,'DEPOSIT',1,'DP-',5)",
    [W.companyA],
  );
});
afterAll(async () => {
  await db?.end();
});
async function receipt(accountId: string = W.undeposited, date = "2026-01-05") {
  const invoiceId = await saveDraft(actor, {
    contactId: W.customer,
    issueDate: "2026-01-01",
    dueDate: "2026-12-01",
    lines: [
      {
        description: "Service dépôt",
        quantity: "1",
        unitPrice: "100",
        accountId: W.sales,
        taxCodeId: W.taxCodeExempt,
      },
    ],
  });
  await postInvoice(
    actor,
    invoiceId,
    (await getDraft(actor, invoiceId))!.revision,
    "2026-01-01",
  );
  const total = (await getInvoiceOpenCents(actor, invoiceId))!;
  const p = await recordReceipt(actor, {
    invoiceId,
    amountCents: String(total),
    expectedOpenCents: String(total),
    date,
    accountId,
    method: "CHEQUE",
    reference: `Bordereau ${randomUUID()}`,
  });
  return { ...p, invoiceId, total };
}
const deposit = (
  ids: string[],
  total: bigint,
  date = "2026-01-10",
  who: CompanyContext = actor,
) =>
  recordDeposit(who, {
    paymentIds: ids,
    accountId: W.bank,
    date,
    expectedTotalCents: String(total),
    reference: "Comptoir",
  });
it("groups receipts once, transfers exact cents and preserves invoice settlements and audit", async () => {
  const a = await receipt(),
    b = await receipt();
  const result = await deposit([a.id, b.id], a.total + b.total);
  const detail = (await getDeposit(reader, result.id))!;
  expect(result.number).toMatch(/^DP-\d{5}$/);
  expect(detail.items).toHaveLength(2);
  expect(detail.totalCents).toBe(a.total + b.total);
  const rows = (
    await db.query(
      "SELECT account_id,debit_cents::text debit,credit_cents::text credit FROM journal_line WHERE entry_id=$1 ORDER BY line_no",
      [detail.journalEntryId],
    )
  ).rows;
  expect(rows).toEqual([
    { account_id: W.bank, debit: String(a.total + b.total), credit: "0" },
    {
      account_id: W.undeposited,
      debit: "0",
      credit: String(a.total + b.total),
    },
  ]);
  expect(await getInvoiceOpenCents(actor, a.invoiceId)).toBe(0n);
  expect((await getReceipt(actor, a.id))!.deposits[0]!.id).toBe(result.id);
  expect(
    (await listPendingDepositReceipts(actor)).receipts.some(
      (p) => p.id === a.id,
    ),
  ).toBe(false);
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM audit_log WHERE entity_type='bank_deposit' AND entity_id=$1",
        [result.id],
      )
    ).rows[0].n,
  ).toBeGreaterThan(0);
  await expect(deposit([a.id], a.total)).rejects.toMatchObject({
    key: "deposits.stale",
  });
  await expect(
    voidReceipt(actor, a.id, { date: "2026-01-20", reason: "Erreur" }),
  ).rejects.toMatchObject({ key: "deposits.receiptBlocked" });
});
it("voids idempotently, preserves history and prevents backdating a redeposit", async () => {
  const p = await receipt();
  const result = await deposit([p.id], p.total);
  await voidDeposit(actor, result.id, {
    date: "2026-01-20",
    reason: "Bordereau corrigé",
  });
  const detail = (await getDeposit(actor, result.id))!;
  expect(detail.status).toBe("VOID");
  expect(detail.voidReason).toBe("Bordereau corrigé");
  const original = detail.voidEntryId;
  await voidDeposit(actor, result.id, {
    date: "2026-01-20",
    reason: "Bordereau corrigé",
  });
  expect((await getDeposit(actor, result.id))!.voidEntryId).toBe(original);
  expect(
    (await listPendingDepositReceipts(actor)).receipts.find(
      (r) => r.id === p.id,
    )!.eligibleDate,
  ).toBe("2026-01-20");
  await expect(deposit([p.id], p.total, "2026-01-19")).rejects.toMatchObject({
    key: "deposits.date",
  });
  const next = await deposit([p.id], p.total, "2026-01-20");
  expect(next.id).not.toBe(result.id);
  expect(
    (await getReceipt(actor, p.id))!.deposits.map((d) => d.status),
  ).toEqual(["POSTED", "VOID"]);
});
it("serializes overlapping deposits and receipt cancellation", async () => {
  const p = await receipt();
  const competing = await Promise.allSettled([
    deposit([p.id], p.total),
    deposit([p.id], p.total),
  ]);
  expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const q = await receipt();
  const results = await Promise.allSettled([
    deposit([q.id], q.total),
    voidReceipt(actor, q.id, { date: "2026-01-20", reason: "Annulé" }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("refuses malformed selections, stale totals, foreign accounts, future dates and unavailable receipts", async () => {
  const p = await receipt();
  await expect(deposit([p.id], p.total + 1n)).rejects.toMatchObject({
    key: "deposits.stale",
  });
  await expect(deposit([p.id, p.id], p.total * 2n)).rejects.toMatchObject({
    key: "deposits.invalid",
  });
  await expect(
    recordDeposit(actor, {
      paymentIds: [p.id],
      expectedTotalCents: String(p.total),
      accountId: W.bankB,
      date: "2026-01-10",
    }),
  ).rejects.toMatchObject({ key: "deposits.account" });
  await expect(deposit([p.id], p.total, "2099-01-01")).rejects.toMatchObject({
    key: "deposits.future",
  });
  await expect(deposit([p.id], p.total, "2026-01-04")).rejects.toMatchObject({
    key: "deposits.date",
  });
  const direct = await receipt(W.bank);
  await expect(deposit([direct.id], direct.total)).rejects.toMatchObject({
    key: "deposits.stale",
  });
  const voided = await receipt();
  await voidReceipt(actor, voided.id, { date: "2026-01-07", reason: "Erreur" });
  await expect(deposit([voided.id], voided.total)).rejects.toMatchObject({
    key: "deposits.stale",
  });
});
it("enforces company and module boundaries and supports accounting-only delegated writers", async () => {
  const p = await receipt();
  const posted = await deposit([p.id], p.total);
  expect(await getDeposit(other, posted.id)).toBeNull();
  expect((await listDeposits(other)).total).toBe(0);
  await expect(
    deposit([p.id], p.total, "2026-01-10", reader),
  ).rejects.toMatchObject({ key: "forbidden" });
  const q = await receipt();
  await db.query(
    'UPDATE membership SET role=\'USER\',module_access=\'{"accounting":"write","sales":"none","contacts":"none"}\' WHERE company_id=$1 AND user_id=$2',
    [W.companyA, W.userAccountant],
  );
  try {
    const result = await deposit([q.id], q.total, "2026-01-10", accountant);
    expect((await getDeposit(accountant, result.id))!.totalCents).toBe(q.total);
  } finally {
    await db.query(
      "UPDATE membership SET role='ACCOUNTANT',module_access='{}' WHERE company_id=$1 AND user_id=$2",
      [W.companyA, W.userAccountant],
    );
  }
  await db.query(
    'UPDATE membership SET module_access=\'{"accounting":"none"}\' WHERE company_id=$1 AND user_id=$2',
    [W.companyA, W.userReader],
  );
  try {
    await expect(listDeposits(reader)).rejects.toMatchObject({
      key: "forbidden",
    });
    expect(
      await withCompany(reader, (tx) => tx.bankDeposit.findMany()),
    ).toEqual([]);
  } finally {
    await db.query(
      "UPDATE membership SET module_access='{}' WHERE company_id=$1 AND user_id=$2",
      [W.companyA, W.userReader],
    );
  }
});
it("refuses voiding a matched deposit and new matches against a void deposit", async () => {
  const p = await receipt();
  const d = await deposit([p.id], p.total);
  const detail = (await getDeposit(actor, d.id))!;
  const line = (
    await db.query(
      "SELECT id FROM journal_line WHERE entry_id=$1 AND account_id=$2",
      [detail.journalEntryId, W.bank],
    )
  ).rows[0].id as string;
  const txn = randomUUID();
  await db.query(
    "INSERT INTO bank_transaction(id,company_id,account_id,txn_date,amount_cents,description,dedupe_key,updated_at) VALUES($1,$2,$3,'2026-01-10',$4,'Dépôt groupé',$5,now())",
    [txn, W.companyA, W.bank, String(p.total), txn],
  );
  await matchTransaction(actor, txn, [line]);
  expect((await getDeposit(actor, d.id))!.linked).toBe(true);
  await expect(
    voidDeposit(actor, d.id, { date: "2026-01-20", reason: "Erreur" }),
  ).rejects.toMatchObject({ key: "deposits.linked" });
  await unmatchTransaction(actor, txn);
  await voidDeposit(actor, d.id, { date: "2026-01-20", reason: "Erreur" });
  await expect(matchTransaction(actor, txn, [line])).rejects.toThrow();
});
it("serializes matching or reconciliation pointing against a concurrent void", async () => {
  for (const kind of ["match", "clear"] as const) {
    const p = await receipt();
    const result = await deposit([p.id], p.total);
    const detail = (await getDeposit(actor, result.id))!;
    const line = (
      await db.query(
        "SELECT id FROM journal_line WHERE entry_id=$1 AND account_id=$2",
        [detail.journalEntryId, W.bank],
      )
    ).rows[0].id as string;
    let link: () => Promise<void>;
    let recId: string | undefined;
    if (kind === "match") {
      const txn = randomUUID();
      await db.query(
        "INSERT INTO bank_transaction(id,company_id,account_id,txn_date,amount_cents,description,dedupe_key,updated_at) VALUES($1,$2,$3,'2026-01-10',$4,'Concurrent deposit',$5,now())",
        [txn, W.companyA, W.bank, String(p.total), txn],
      );
      link = () => matchTransaction(actor, txn, [line]);
    } else {
      recId = (
        await startReconciliation(actor, {
          accountId: W.bank,
          statementDate: "2026-01-31",
          statementBalanceCents: 0n,
        })
      ).id;
      const id = recId;
      link = () => saveCleared(actor, id, [line]);
    }
    const results = await Promise.allSettled([
      link(),
      voidDeposit(actor, result.id, {
        date: "2026-01-20",
        reason: "Concurrent correction",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    if (recId) await saveCleared(actor, recId, []);
  }
});
it("rolls back in a locked period and rejects split postings that hide unrelated amounts", async () => {
  const p = await receipt();
  const period = (
    await db.query(
      "SELECT id FROM fiscal_period WHERE company_id=$1 AND start_date<='2026-01-10' AND end_date>='2026-01-10'",
      [W.companyA],
    )
  ).rows[0].id as string;
  await lockPeriod(actor, period); // restore immediately for the other guard case
  await expect(deposit([p.id], p.total)).rejects.toMatchObject({
    key: "AL003",
  });
  await db.query(
    "UPDATE fiscal_period SET status='OPEN',locked_at=NULL,locked_by_id=NULL WHERE id=$1",
    [period],
  );
  await expect(
    withCompany(actor, async (tx) => {
      const id = randomUUID();
      const entry = await createDepositEntry(tx, actor, {
        depositId: id,
        date: "2026-01-10",
        memo: "Extra hidden posting",
        lines: [
          { accountId: W.bank, debitCents: p.total, creditCents: 0n },
          { accountId: W.undeposited, debitCents: 0n, creditCents: p.total },
          { accountId: W.expenses, debitCents: 1n, creditCents: 0n },
          { accountId: W.sales, debitCents: 0n, creditCents: 1n },
        ],
      });
      await tx.bankDeposit.create({
        data: {
          id,
          companyId: W.companyA,
          accountId: W.bank,
          depositDate: new Date("2026-01-10T00:00:00Z"),
          totalCents: p.total,
          journalEntryId: entry.id,
          createdById: W.userOwnerA,
        },
      });
      await tx.bankDepositItem.create({
        data: { companyId: W.companyA, depositId: id, paymentId: p.id },
      });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    }),
  ).rejects.toThrow();
  expect(
    (await listPendingDepositReceipts(actor)).receipts.some(
      (r) => r.id === p.id,
    ),
  ).toBe(true);
});
it("rejects writes at an isolation level that could reuse an outdated availability snapshot", async () => {
  const client = await appClient();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await setContext(client, actor);
    await expect(
      client.query(
        "INSERT INTO bank_deposit(id,company_id,account_id,deposit_date,total_cents,journal_entry_id,created_by_id,updated_at) VALUES($1,$2,$3,'2026-01-10',100,$4,$5,now())",
        [randomUUID(), W.companyA, W.bank, randomUUID(), W.userOwnerA],
      ),
    ).rejects.toMatchObject({
      code: "AL010",
      message: "deposit writes require read committed isolation",
    });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
