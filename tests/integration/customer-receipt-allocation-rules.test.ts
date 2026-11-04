import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getDraft, postInvoice, saveDraft } from "@/modules/sales";
import { owner } from "./helpers";
import { appClient, asAccountant, asOwnerA, entry, inContext, line, seedWorld, setContext, W } from "./world";

const actor = { companyId: W.companyA, userId: W.userOwnerA };
let db: pg.Client;
let entryNo = 900_000;
type Payment = { id: string; journal: string };
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });

async function invoice(contactId: string = W.customer) {
  const id = await saveDraft(actor, { contactId, issueDate: "2026-01-01", dueDate: "2026-02-01", lines: [{ description: "Receipt rules", quantity: "1", unitPrice: "1", accountId: W.sales, taxCodeId: W.taxCodeExempt }] });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, "2026-01-01");
  return id;
}
async function insertPayment(client: pg.Client, received = true): Promise<Payment> {
  const id = randomUUID(), journal = randomUUID();
  await entry(client, { id: journal, no: entryNo++, date: "2026-01-02", source: "PAYMENT", sourceId: id });
  await line(client, journal, 1, W.bank, received ? { debit: 100 } : { credit: 100 });
  await line(client, journal, 2, W.receivable, { ...(received ? { credit: 100 } : { debit: 100 }), contact: W.customer });
  await client.query(
    "INSERT INTO payment(id,company_id,direction,ledger,contact_id,payment_date,amount_cents,account_id,method,journal_entry_id,created_by_id,updated_at) VALUES($1,$2,$3,'RECEIVABLE',$4,'2026-01-02',100,$5,'EFT',$6,$7,now())",
    [id, W.companyA, received ? "RECEIVED" : "SENT", W.customer, W.bank, journal, W.userOwnerA],
  );
  return { id, journal };
}
async function payment(received = true) {
  const client = await appClient();
  try { return await inContext(client, asOwnerA, () => insertPayment(client, received), { commit: true }); }
  finally { await client.end(); }
}
async function allocate(client: pg.Client, paymentId: string, invoiceId: string, date = "2026-01-10") {
  const id = randomUUID();
  await client.query("INSERT INTO payment_allocation(id,company_id,payment_id,sales_document_id,amount_cents,applied_date,created_by_id) VALUES($1,$2,$3,$4,100,$5,$6)", [id, W.companyA, paymentId, invoiceId, date, W.userOwnerA]);
  return id;
}
async function offset(client: pg.Client, received: string, sent: string, date = "2026-01-10", unapplied: string | null = null) {
  const id = randomUUID();
  await client.query(
    "INSERT INTO payment_offset(id,company_id,received_payment_id,sent_payment_id,amount_cents,applied_date,created_by_id,unapplied_date,unapplied_by_id) VALUES($1,$2,$3,$4,100,$5,$6,$7,CASE WHEN $7::date IS NULL THEN NULL ELSE $6::uuid END)",
    [id, W.companyA, received, sent, date, W.userOwnerA, unapplied],
  );
  return id;
}
const unapply = (client: pg.Client, id: string, date = "2026-01-20", table = "payment_allocation") => {
  if (table !== "payment_allocation" && table !== "payment_offset") throw new Error("unknown history table");
  return client.query(`UPDATE ${table} SET unapplied_date=$2,unapplied_by_id=$3 WHERE company_id=$4 AND id=$1`, [id, date, W.userOwnerA, W.companyA]);
};
async function rollback(client: pg.Client) { await client.query("ROLLBACK"); await client.end(); }
async function cancel(client: pg.Client, p: Payment, date: string) {
  const reversal = randomUUID();
  await entry(client, { id: reversal, no: entryNo++, date, source: "REVERSAL", reverses: p.journal });
  await line(client, reversal, 1, W.bank, { credit: 100 });
  await line(client, reversal, 2, W.receivable, { debit: 100, contact: W.customer });
  return client.query("UPDATE payment SET status='VOID',void_entry_id=$3,voided_at=now(),voided_by_id=$4,void_reason='Correction',updated_at=now() WHERE company_id=$1 AND id=$2", [W.companyA, p.id, reversal, W.userOwnerA]);
}

it("tracks a receipt's dated availability across different invoices", async () => {
  const p = await payment(), first = await invoice(), second = await invoice(), client = await appClient();
  try {
    const id = await inContext(client, asOwnerA, () => allocate(client, p.id, first), { commit: true });
    await inContext(client, asOwnerA, () => unapply(client, id), { commit: true });
    await expect(inContext(client, asOwnerA, () => allocate(client, p.id, second, "2026-01-15"))).rejects.toMatchObject({ code: "AL007", message: "customer receipt movement predates a payment movement" });
    await expect(inContext(client, asOwnerA, () => allocate(client, p.id, second, "2026-01-20"))).resolves.toBeTypeOf("string");
    expect((await db.query("SELECT payment_open_cents($1,$2,'2026-01-15')::text AS n", [W.companyA, p.id])).rows[0].n).toBe("0");
  } finally { await client.end(); }
});

it("serializes a new allocation after a committed allocation against the same reviewed payment", async () => {
  const p = await payment(), first = await invoice(), second = await invoice();
  const clients = await Promise.all([appClient(), appClient()]);
  try {
    const results = await Promise.allSettled(clients.map((client, i) => inContext(client, asOwnerA, () => allocate(client, p.id, i ? second : first), { commit: true })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await db.query("SELECT payment_open_cents($1,$2)::text AS n", [W.companyA, p.id])).rows[0].n).toBe("0");
  } finally { await Promise.all(clients.map(client => client.end())); }
});

it("requires monotonic dates from allocations to offsets and back to allocations", async () => {
  const p = await payment(), sent = await payment(false), first = await invoice(), second = await invoice(), client = await appClient();
  try {
    const allocation = await inContext(client, asOwnerA, () => allocate(client, p.id, first), { commit: true });
    await inContext(client, asOwnerA, () => unapply(client, allocation), { commit: true });
    await expect(inContext(client, asOwnerA, () => offset(client, p.id, sent.id, "2026-01-15"))).rejects.toMatchObject({ code: "AL007" });
    const link = await inContext(client, asOwnerA, () => offset(client, p.id, sent.id, "2026-01-20"), { commit: true });
    await inContext(client, asOwnerA, () => unapply(client, link, "2026-01-25", "payment_offset"), { commit: true });
    await expect(inContext(client, asOwnerA, () => allocate(client, p.id, second, "2026-01-22"))).rejects.toMatchObject({ code: "AL007" });
    await expect(inContext(client, asOwnerA, () => allocate(client, p.id, second, "2026-01-25"))).resolves.toBeTypeOf("string");
  } finally { await client.end(); }
});

it("refuses a stale RR offset after another connection allocates the receipt", async () => {
  const p = await payment(), sent = await payment(false), target = await invoice();
  const stale = await appClient(), current = await appClient();
  try {
    await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await setContext(stale, asOwnerA);
    expect((await stale.query("SELECT payment_open_cents($1,$2)::text AS n", [W.companyA, p.id])).rows[0].n).toBe("100");
    await inContext(current, asOwnerA, () => allocate(current, p.id, target), { commit: true });
    await expect(offset(stale, p.id, sent.id)).rejects.toMatchObject({ code: "AL007", message: "customer receipt movements require read committed isolation" });
  } finally { await rollback(stale); await current.end(); }
});

it("requires Sales write even when Accounting write makes the receipt visible", async () => {
  const p = await payment(), sent = await payment(false), target = await invoice(), client = await appClient();
  try {
    for (const sales of ["read", "none"]) {
      await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify({ sales, accounting: "write" })]);
      await expect(inContext(client, asAccountant, () => insertPayment(client))).rejects.toMatchObject({ code: "42501" });
      await expect(inContext(client, asAccountant, () => allocate(client, p.id, target))).rejects.toMatchObject({ code: "42501" });
      await expect(inContext(client, asAccountant, () => offset(client, p.id, sent.id))).rejects.toMatchObject({ code: "42501" });
    }
  } finally {
    await db.query("UPDATE membership SET module_access='{}'::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
    await client.end();
  }
});

it("does not let a receipt cancellation predate its historical release", async () => {
  const p = await payment(), target = await invoice(), client = await appClient();
  try {
    const id = await inContext(client, asOwnerA, () => allocate(client, p.id, target), { commit: true });
    await inContext(client, asOwnerA, () => unapply(client, id), { commit: true });
    await expect(inContext(client, asOwnerA, () => cancel(client, p, "2026-01-15"))).rejects.toMatchObject({ code: "AL006", message: "customer receipt cancellation predates a payment movement" });
    await expect(inContext(client, asOwnerA, () => cancel(client, p, "2026-01-20"))).resolves.toBeDefined();
  } finally { await client.end(); }
});

it("refuses pre-unapplied offsets, future dates and repeated releases", async () => {
  const p = await payment(), sent = await payment(false), client = await appClient();
  try {
    await expect(inContext(client, asOwnerA, () => offset(client, p.id, sent.id, "2026-01-10", "2026-01-20"))).rejects.toMatchObject({ code: "AL007" });
    await expect(inContext(client, asOwnerA, () => offset(client, p.id, sent.id, "2999-01-01"))).rejects.toMatchObject({ code: "AL007" });
    const id = await inContext(client, asOwnerA, () => offset(client, p.id, sent.id), { commit: true });
    await expect(inContext(client, asOwnerA, () => unapply(client, id, "2999-01-01", "payment_offset"))).rejects.toMatchObject({ code: "AL007" });
    await inContext(client, asOwnerA, () => unapply(client, id, "2026-01-20", "payment_offset"), { commit: true });
    await expect(inContext(client, asOwnerA, () => unapply(client, id, "2026-01-25", "payment_offset"))).rejects.toMatchObject({ code: "AL007" });
  } finally { await client.end(); }
});

it("keeps an offset's fiscal period locked against concurrent closure until commit", async () => {
  const p = await payment(), sent = await payment(false), client = await appClient(), closer = await appClient();
  try {
    await client.query("BEGIN");
    await setContext(client, asOwnerA);
    await offset(client, p.id, sent.id);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await closer.query("BEGIN");
    await setContext(closer, asOwnerA);
    await closer.query("SET LOCAL lock_timeout='100ms'");
    await expect(closer.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND '2026-01-10'::date BETWEEN start_date AND end_date", [W.companyA, W.userOwnerA])).rejects.toMatchObject({ code: "55P03" });
  } finally { await rollback(closer); await rollback(client); }
});

it("preserves the same-customer and composite company foreign-key backstops", async () => {
  const p = await payment(), wrongCustomer = await invoice(W.otherCustomer), target = await invoice(), client = await appClient();
  try {
    await expect(inContext(client, asOwnerA, () => allocate(client, p.id, wrongCustomer))).rejects.toMatchObject({ code: "AL007" });
    await expect(inContext(client, asOwnerA, () => allocate(client, randomUUID(), target))).rejects.toMatchObject({ code: "23503" });
    await expect(inContext(client, asOwnerA, () => client.query("INSERT INTO payment_allocation(id,company_id,payment_id,sales_document_id,amount_cents,applied_date,created_by_id) VALUES($1,$2,$3,$4,100,'2026-01-10',$5)", [randomUUID(), W.companyB, p.id, target, W.userOwnerA]))).rejects.toThrow();
  } finally { await client.end(); }
});
