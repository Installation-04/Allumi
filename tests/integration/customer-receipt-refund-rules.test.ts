import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getCreditDraft, getDraft, getInvoice, postCreditNote, postInvoice, saveCreditDraft, saveDraft } from "@/modules/sales";
import { owner } from "./helpers";
import { appClient, asAccountant, asOwnerA, entry, inContext, line, seedWorld, setContext, W } from "./world";

const actor = { companyId: W.companyA, userId: W.userOwnerA };
type Payment = { id: string; journal: string };
let db: pg.Client;
let entryNo = 900_000;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });
async function insertPayment(client: pg.Client, options: { received?: boolean; contact?: string; account?: string; date?: string } = {}): Promise<Payment> {
  const received = options.received ?? false, contact = options.contact ?? W.customer, account = options.account ?? W.bank;
  const id = randomUUID(), journal = randomUUID();
  await entry(client, { id: journal, no: entryNo++, date: "2026-01-02", source: "PAYMENT", sourceId: id });
  await line(client, journal, 1, account, received ? { debit: 100 } : { credit: 100 });
  await line(client, journal, 2, W.receivable, { ...(received ? { credit: 100 } : { debit: 100 }), contact });
  await client.query(
    "INSERT INTO payment(id,company_id,direction,ledger,contact_id,payment_date,amount_cents,account_id,method,journal_entry_id,created_by_id,updated_at) VALUES($1,$2,$3,'RECEIVABLE',$4,$5::date,100,$6,'EFT',$7,$8,now())",
    [id, W.companyA, received ? "RECEIVED" : "SENT", contact, options.date ?? "2026-01-02", account, journal, W.userOwnerA],
  );
  return { id, journal };
}
async function payment(options: Parameters<typeof insertPayment>[1] = {}) {
  const client = await appClient();
  try { return await inContext(client, asOwnerA, () => insertPayment(client, options), { commit: true }); }
  finally { await client.end(); }
}
async function offset(client: pg.Client, received: string, sent: string, date = "2026-01-10") {
  const id = randomUUID();
  await client.query("INSERT INTO payment_offset(id,company_id,received_payment_id,sent_payment_id,amount_cents,applied_date,created_by_id) VALUES($1,$2,$3,$4,100,$5,$6)", [id, W.companyA, received, sent, date, W.userOwnerA]);
  return id;
}
async function invoice() {
  const id = await saveDraft(actor, { contactId: W.customer, issueDate: "2026-01-01", dueDate: "2026-02-01", lines: [{ description: "Refund rules", quantity: "1", unitPrice: "1", accountId: W.sales, taxCodeId: W.taxCodeExempt }] });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, "2026-01-01");
  return id;
}
async function credit() {
  const source = await invoice(), posted = (await getInvoice(actor, source))!;
  const id = await saveCreditDraft(actor, source, { issueDate: "2026-01-02", memo: "Refund rules", lines: [{ lineId: posted.lines[0]!.id, amount: "1" }] });
  await postCreditNote(actor, id, (await getCreditDraft(actor, id))!.revision, "2026-01-02", { applicationMode: "UNAPPLIED" });
  return id;
}
async function allocate(client: pg.Client, paymentId: string, documentId: string, date = "2026-01-15") {
  return client.query("INSERT INTO payment_allocation(id,company_id,payment_id,sales_document_id,amount_cents,applied_date,created_by_id) VALUES($1,$2,$3,$4,100,$5,$6)", [randomUUID(), W.companyA, paymentId, documentId, date, W.userOwnerA]);
}
async function cancel(client: pg.Client, p: Payment, date: string) {
  const reversal = randomUUID();
  await entry(client, { id: reversal, no: entryNo++, date, source: "REVERSAL", reverses: p.journal });
  await line(client, reversal, 1, W.bank, { debit: 100 });
  await line(client, reversal, 2, W.receivable, { credit: 100, contact: W.customer });
  return client.query("UPDATE payment SET status='VOID',void_entry_id=$3,voided_at=now(),voided_by_id=$4,void_reason='Correction',updated_at=now() WHERE company_id=$1 AND id=$2", [W.companyA, p.id, reversal, W.userOwnerA]);
}
async function rollback(client: pg.Client) { await client.query("ROLLBACK"); await client.end(); }
async function release(client: pg.Client, id: string) {
  return client.query("UPDATE payment_offset SET unapplied_date='2026-01-20',unapplied_by_id=$2 WHERE id=$1 AND company_id=$3", [id, W.userOwnerA, W.companyA]);
}

it("requires Sales and Accounting write for outgoing customer refunds and refuses future headers", async () => {
  const client = await appClient();
  try {
    await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify({ sales: "read", accounting: "write" })]);
    await expect(inContext(client, asAccountant, () => insertPayment(client))).rejects.toMatchObject({ code: "42501" });
    // The header guard must reject the future date itself, before the older posting/date-link guard.
    await expect(inContext(client, asOwnerA, () => insertPayment(client, { date: "2999-01-01" }))).rejects.toMatchObject({ code: "AL006", message: "customer receipt dates cannot be in the future" });
  } finally {
    await db.query("UPDATE membership SET module_access='{}'::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
    await client.end();
  }
});

it("never voids or reuses an outgoing refund before its offset was released", async () => {
  const received = await payment({ received: true }), sent = await payment(), target = await credit(), client = await appClient();
  try {
    const link = await inContext(client, asOwnerA, () => offset(client, received.id, sent.id), { commit: true });
    await inContext(client, asOwnerA, () => release(client, link), { commit: true });
    await expect(inContext(client, asOwnerA, () => cancel(client, sent, "2026-01-15"))).rejects.toMatchObject({ code: "AL006", message: "customer receipt cancellation predates a payment movement" });
    await expect(inContext(client, asOwnerA, () => allocate(client, sent.id, target))).rejects.toMatchObject({ code: "AL007", message: "customer receipt movement predates a payment movement" });
    await expect(inContext(client, asOwnerA, () => allocate(client, sent.id, target, "2026-01-20"))).resolves.toBeDefined();
    await expect(inContext(client, asOwnerA, () => cancel(client, sent, "2026-01-20"))).resolves.toBeDefined();
  } finally { await client.end(); }
});

it("rejects stale RR consumption of an outgoing refund after a concurrent offset", async () => {
  const received = await payment({ received: true }), sent = await payment(), target = await credit();
  const stale = await appClient(), current = await appClient();
  try {
    await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await setContext(stale, asOwnerA);
    await stale.query("SELECT payment_open_cents($1,$2)", [W.companyA, sent.id]);
    await inContext(current, asOwnerA, () => offset(current, received.id, sent.id), { commit: true });
    await expect(allocate(stale, sent.id, target)).rejects.toMatchObject({ code: "AL007" });
  } finally { await rollback(stale); await current.end(); }
});

it("allows exactly bank/cash credit and customer receivable debit without revenue or tax lines", async () => {
  const client = await appClient();
  try {
    await expect(inContext(client, asOwnerA, () => insertPayment(client))).resolves.toHaveProperty("id");
    await expect(inContext(client, asOwnerA, () => insertPayment(client, { account: W.undeposited }))).rejects.toMatchObject({ code: "AL006" });
    await expect(inContext(client, asOwnerA, async () => {
      const p = await insertPayment(client);
      await line(client, p.journal, 3, W.expenses, { debit: 50 });
      await line(client, p.journal, 4, W.sales, { credit: 50 });
    })).rejects.toMatchObject({ code: "AL006", message: "customer refund posting must contain exactly its bank and receivable lines" });
    await expect(inContext(client, asOwnerA, async () => {
      const p = await insertPayment(client);
      await line(client, p.journal, 3, W.gstPayable, { debit: 50, tax: W.gst, box: "COLLECTED" });
      await line(client, p.journal, 4, W.sales, { credit: 50 });
    })).rejects.toMatchObject({ code: "AL006", message: "customer refund posting must contain exactly its bank and receivable lines" });
  } finally { await client.end(); }
});

it("rechecks exact refund lines appended after SET CONSTRAINTS IMMEDIATE", async () => {
  const client = await appClient();
  try {
    await expect(inContext(client, asOwnerA, async () => {
      const p = await insertPayment(client);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query(
        "INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,entry_date) VALUES(gen_random_uuid(),$1,$2,3,$3,50,0,'2026-01-02'),(gen_random_uuid(),$1,$2,4,$4,0,50,'2026-01-02')",
        [W.companyA, p.journal, W.expenses, W.sales],
      );
    })).rejects.toMatchObject({ code: "AL006", message: "customer refund posting must contain exactly its bank and receivable lines" });
  } finally { await client.end(); }
});

it("preserves offset direction, customer, status and company restrictions", async () => {
  const received = await payment({ received: true }), sent = await payment(), otherCustomer = await payment({ contact: W.otherCustomer }), client = await appClient();
  try {
    await expect(inContext(client, asOwnerA, () => offset(client, sent.id, received.id))).rejects.toMatchObject({ code: "AL007" });
    await expect(inContext(client, asOwnerA, () => offset(client, received.id, otherCustomer.id))).rejects.toMatchObject({ code: "AL007" });
    await expect(inContext(client, asOwnerA, () => offset(client, received.id, randomUUID()))).rejects.toMatchObject({ code: "23503" });
    await expect(inContext(client, asOwnerA, () => client.query("INSERT INTO payment_offset(id,company_id,received_payment_id,sent_payment_id,amount_cents,applied_date,created_by_id) VALUES($1,$2,$3,$4,100,'2026-01-10',$5)", [randomUUID(), W.companyB, received.id, sent.id, W.userOwnerA]))).rejects.toThrow();
    await inContext(client, asOwnerA, () => cancel(client, sent, "2026-01-10"), { commit: true });
    await expect(inContext(client, asOwnerA, () => offset(client, received.id, sent.id))).rejects.toMatchObject({ code: "AL007" });
  } finally { await client.end(); }
});
