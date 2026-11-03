import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { recordDeposit, voidReceipt } from "@/modules/payments";
import { owner } from "./helpers";
import {
  appClient,
  asOwnerA,
  entry,
  inContext,
  line,
  seedWorld,
  setContext,
  W,
} from "./world";

let db: pg.Client;
let nextEntry = 900_000;
const actor = { userId: W.userOwnerA, companyId: W.companyA };

beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query(
    "INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'DEPOSIT',1,'DP-',5)",
    [W.companyA],
  );
});
afterAll(async () => {
  await db?.end();
});

/** An unallocated customer receipt, so allocation locks cannot mask the deposit race. */
async function receipt() {
  const client = await appClient();
  const id = randomUUID();
  const journalEntryId = randomUUID();
  try {
    await inContext(
      client,
      asOwnerA,
      async () => {
        await entry(client, {
          id: journalEntryId,
          no: nextEntry++,
          date: "2026-01-05",
          source: "PAYMENT",
          sourceId: id,
        });
        await line(client, journalEntryId, 1, W.undeposited, { debit: 100 });
        await line(client, journalEntryId, 2, W.receivable, {
          credit: 100,
          contact: W.customer,
        });
        await client.query(
          `INSERT INTO payment(id,company_id,direction,ledger,contact_id,payment_date,amount_cents,account_id,method,journal_entry_id,created_by_id,updated_at)
         VALUES($1,$2,'RECEIVED','RECEIVABLE',$3,'2026-01-05',100,$4,'CHEQUE',$5,$6,now())`,
          [
            id,
            W.companyA,
            W.customer,
            W.undeposited,
            journalEntryId,
            W.userOwnerA,
          ],
        );
      },
      { commit: true },
    );
    return { id, journalEntryId };
  } finally {
    await client.end();
  }
}

async function prepareReversal(client: pg.Client, journalEntryId: string) {
  const id = randomUUID();
  await entry(client, {
    id,
    no: nextEntry++,
    date: "2026-01-20",
    source: "REVERSAL",
    reverses: journalEntryId,
  });
  await line(client, id, 1, W.undeposited, { credit: 100 });
  await line(client, id, 2, W.receivable, { debit: 100, contact: W.customer });
  return id;
}

it("refuses a stale repeatable-read cancellation after another connection deposits the receipt", async () => {
  const payment = await receipt();
  const stale = await appClient();
  try {
    await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await setContext(stale, asOwnerA);
    expect(
      (
        await stale.query(
          "SELECT status FROM payment WHERE company_id=$1 AND id=$2",
          [W.companyA, payment.id],
        )
      ).rows,
    ).toEqual([{ status: "POSTED" }]);
    // T2 commits without updating payment: a row lock alone does not invalidate T1's old snapshot.
    const deposit = await recordDeposit(actor, {
      paymentIds: [payment.id],
      accountId: W.bank,
      date: "2026-01-10",
      expectedTotalCents: "100",
    });
    expect(
      (
        await stale.query(
          "SELECT id FROM bank_deposit WHERE company_id=$1 AND id=$2",
          [W.companyA, deposit.id],
        )
      ).rowCount,
    ).toBe(0);
    const reversalId = await prepareReversal(stale, payment.journalEntryId);
    await expect(
      stale.query(
        `UPDATE payment SET status='VOID',void_entry_id=$3,voided_at=now(),voided_by_id=$4,void_reason='Correction',updated_at=now()
       WHERE company_id=$1 AND id=$2`,
        [W.companyA, payment.id, reversalId, W.userOwnerA],
      ),
    ).rejects.toMatchObject({
      code: "AL006",
      message: "payment cancellation requires read committed isolation",
    });
  } finally {
    await stale.query("ROLLBACK");
    await stale.end();
  }
  expect(
    (
      await db.query(
        "SELECT status FROM payment WHERE company_id=$1 AND id=$2",
        [W.companyA, payment.id],
      )
    ).rows,
  ).toEqual([{ status: "POSTED" }]);
});

it("preserves read-committed cancellation and the deposited-receipt refusal", async () => {
  const available = await receipt();
  await expect(
    voidReceipt(actor, available.id, {
      date: "2026-01-20",
      reason: "Correction",
    }),
  ).resolves.toBe(available.id);
  const deposited = await receipt();
  await recordDeposit(actor, {
    paymentIds: [deposited.id],
    accountId: W.bank,
    date: "2026-01-10",
    expectedTotalCents: "100",
  });
  await expect(
    voidReceipt(actor, deposited.id, {
      date: "2026-01-20",
      reason: "Correction",
    }),
  ).rejects.toMatchObject({ key: "deposits.receiptBlocked" });
});
