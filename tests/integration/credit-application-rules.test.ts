import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getDraft, getInvoice, getCreditDraft, postInvoice, postCreditNote, saveDraft, saveCreditDraft } from "@/modules/sales";
import { recordCustomerRefund } from "@/modules/payments";
import { owner } from "./helpers";
import { appClient, asOwnerA, asAccountant, entry, inContext, line, seedWorld, setContext, W } from "./world";

const actor = { companyId: W.companyA, userId: W.userOwnerA };
let db: pg.Client;
let entryNo = 900_000;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PAYMENT_SENT',1,'R-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });

async function invoice() {
  const id = await saveDraft(actor, {
    contactId: W.customer, issueDate: "2026-01-01", dueDate: "2026-02-01",
    lines: [{ description: "Credit rules", quantity: "1", unitPrice: "1", accountId: W.sales, taxCodeId: W.taxCodeExempt }],
  });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, "2026-01-01");
  return id;
}
async function fixtures() {
  const source = await invoice();
  const original = (await getInvoice(actor, source))!;
  const credit = await saveCreditDraft(actor, source, {
    issueDate: "2026-01-02", memo: "Credit rules", lines: [{ lineId: original.lines[0]!.id, amount: "1" }],
  });
  await postCreditNote(actor, credit, (await getCreditDraft(actor, credit))!.revision, "2026-01-02", { applicationMode: "UNAPPLIED" });
  return { credit, target: await invoice() };
}
async function apply(client: pg.Client, credit: string, invoice: string, date = "2026-01-10", unapplied: string | null = null) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO sales_credit_application(id,company_id,credit_note_id,invoice_id,amount_cents,applied_date,created_by_id,unapplied_date,unapplied_by_id)
     VALUES($1,$2,$3,$4,100,$5,$6,$7,CASE WHEN $7::date IS NULL THEN NULL ELSE $6::uuid END)`,
    [id, W.companyA, credit, invoice, date, W.userOwnerA, unapplied],
  );
  return id;
}
async function refund(creditNoteId: string, date = "2026-01-10") {
  return recordCustomerRefund(actor, { creditNoteId, amountCents: "100", expectedOpenCents: "100", date, accountId: W.bank, method: "EFT" });
}
async function rollback(client: pg.Client) { await client.query("ROLLBACK"); await client.end(); }
async function mirror(client: pg.Client, original: string) {
  const id = randomUUID();
  await entry(client, { id, no: entryNo++, date: "2026-01-25", source: "REVERSAL", reverses: original });
  await client.query(
    `INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,contact_id,entry_date,tax_id,tax_box)
     SELECT gen_random_uuid(),company_id,$2,line_no,account_id,credit_cents,debit_cents,contact_id,'2026-01-25',tax_id,tax_box FROM journal_line WHERE company_id=$3 AND entry_id=$1`,
    [original, id, W.companyA],
  );
  return id;
}

it("rejects RR application after a concurrently committed refund", async () => {
  const { credit, target } = await fixtures();
  const stale = await appClient();
  try {
    await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await setContext(stale, asOwnerA);
    expect((await stale.query("SELECT sales_document_open_cents($1,$2)::text AS n", [W.companyA, credit])).rows[0].n).toBe("100");
    await refund(credit);
    await expect(apply(stale, credit, target)).rejects.toMatchObject({ code: "AL007", message: "customer applications require read committed isolation" });
  } finally { await rollback(stale); }
});

it("rejects RR refund allocation after a concurrently committed credit application", async () => {
  const { credit, target } = await fixtures();
  const stale = await appClient(), other = await appClient();
  try {
    await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await setContext(stale, asOwnerA);
    await stale.query("SELECT sales_document_open_cents($1,$2)", [W.companyA, credit]);
    await inContext(other, asOwnerA, () => apply(other, credit, target), { commit: true });
    const payment = randomUUID(), journal = randomUUID();
    await entry(stale, { id: journal, no: entryNo++, date: "2026-01-10", source: "PAYMENT", sourceId: payment });
    await line(stale, journal, 1, W.bank, { credit: 100 });
    await line(stale, journal, 2, W.receivable, { debit: 100, contact: W.customer });
    await stale.query(
      "INSERT INTO payment(id,company_id,direction,ledger,contact_id,payment_date,amount_cents,account_id,method,journal_entry_id,created_by_id,updated_at) VALUES($1,$2,'SENT','RECEIVABLE',$3,'2026-01-10',100,$4,'EFT',$5,$6,now())",
      [payment, W.companyA, W.customer, W.bank, journal, W.userOwnerA],
    );
    await expect(stale.query(
      "INSERT INTO payment_allocation(id,company_id,payment_id,sales_document_id,amount_cents,applied_date,created_by_id) VALUES($1,$2,$3,$4,100,'2026-01-10',$5)",
      [randomUUID(), W.companyA, payment, credit, W.userOwnerA],
    )).rejects.toMatchObject({ code: "AL007", message: "customer receipt movements require read committed isolation" });
  } finally { await rollback(stale); await other.end(); }
});

it("rejects RR document cancellation after another connection applies its credit", async () => {
  const { credit, target } = await fixtures();
  const stale = await appClient(), other = await appClient();
  try {
    await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await setContext(stale, asOwnerA);
    const original = (await stale.query("SELECT journal_entry_id FROM sales_document WHERE company_id=$1 AND id=$2", [W.companyA, credit])).rows[0].journal_entry_id;
    await inContext(other, asOwnerA, () => apply(other, credit, target), { commit: true });
    const reversal = await mirror(stale, original);
    await expect(stale.query(
      "UPDATE sales_document SET status='VOID',void_entry_id=$3,voided_at=now(),voided_by_id=$4,void_reason='Correction',updated_at=now() WHERE company_id=$1 AND id=$2",
      [W.companyA, credit, reversal, W.userOwnerA],
    )).rejects.toMatchObject({ code: "AL006", message: "customer document cancellation requires read committed isolation" });
  } finally { await rollback(stale); await other.end(); }
});

it("preserves historical balances when an application was released later", async () => {
  const { credit, target } = await fixtures();
  const client = await appClient();
  try {
    const id = await inContext(client, asOwnerA, () => apply(client, credit, target), { commit: true });
    await inContext(client, asOwnerA, () => client.query("UPDATE sales_credit_application SET unapplied_date='2026-01-20',unapplied_by_id=$2 WHERE id=$1", [id, W.userOwnerA]), { commit: true });
    await expect(inContext(client, asOwnerA, () => apply(client, credit, target, "2026-01-15"))).rejects.toMatchObject({ code: "AL007" });
    await expect(inContext(client, asOwnerA, () => apply(client, credit, target, "2026-01-20"))).resolves.toBeTypeOf("string");
    const historical = await db.query("SELECT sales_document_open_cents($1,$2,'2026-01-15')::text AS n", [W.companyA, credit]);
    expect(historical.rows[0].n).toBe("0");
    await expect(refund(credit, "2026-01-15")).rejects.toThrow();
  } finally { await client.end(); }
});

it("requires Accounting write as well as Sales write even through direct SQL", async () => {
  const { credit, target } = await fixtures();
  await refund(credit);
  const client = await appClient();
  try {
    await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify({ sales: "write", accounting: "none" })]);
    await expect(inContext(client, asAccountant, () => apply(client, credit, target))).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.query("UPDATE membership SET module_access='{}'::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
    await client.end();
  }
});

it("refuses pre-unapplied insertions and future application/unapplication dates", async () => {
  const { credit, target } = await fixtures();
  const client = await appClient();
  try {
    await expect(inContext(client, asOwnerA, () => apply(client, credit, target, "2026-01-10", "2026-01-20"))).rejects.toMatchObject({ code: "AL007", message: "customer applications must be created active" });
    await expect(inContext(client, asOwnerA, () => apply(client, credit, target, "2999-01-01"))).rejects.toMatchObject({ code: "AL007" });
    const id = await inContext(client, asOwnerA, () => apply(client, credit, target), { commit: true });
    await expect(inContext(client, asOwnerA, () => client.query("UPDATE sales_credit_application SET unapplied_date='2999-01-01',unapplied_by_id=$2 WHERE id=$1", [id, W.userOwnerA]))).rejects.toMatchObject({ code: "AL007" });
  } finally { await client.end(); }
});

it("holds the effective fiscal period through commit so a concurrent closure waits", async () => {
  const { credit, target } = await fixtures();
  const client = await appClient(), closer = await appClient();
  try {
    await client.query("BEGIN");
    await setContext(client, asOwnerA);
    await apply(client, credit, target);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await closer.query("BEGIN");
    await setContext(closer, asOwnerA);
    await closer.query("SET LOCAL lock_timeout='100ms'");
    await expect(closer.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND '2026-01-10'::date BETWEEN start_date AND end_date", [W.companyA, W.userOwnerA]))
      .rejects.toMatchObject({ code: "55P03" });
  } finally { await rollback(closer); await rollback(client); }
});
