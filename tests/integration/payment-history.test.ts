import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  getDraft,
  getInvoice,
  getInvoiceOpenCents,
  getCreditDraft,
  postInvoice,
  postCreditNote,
  saveDraft,
  saveCreditDraft,
} from "@/modules/sales";
import {
  getReceipt,
  listReceipts,
  listCustomerRefunds,
  recordReceipt,
  recordCustomerRefund,
  voidReceipt,
  voidCustomerRefund,
} from "@/modules/payments";
import { getContact } from "@/modules/contacts";
import { owner } from "./helpers";
import {
  seedWorld,
  W,
  appClient,
  inContext,
  asOwnerA,
  entry,
  line,
} from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA },
  reader = { ...actor, userId: W.userReader };
let db: pg.Client, source: string, refundId: string;
const receipts: { id: string; number: string }[] = [];
const now = new Date("2026-12-31T12:00:00Z");
async function invoice(contactId: string) {
  const id = await saveDraft(actor, {
    contactId,
    issueDate: "2026-01-01",
    dueDate: "2026-02-01",
    lines: [
      {
        description: "History fixture",
        quantity: "1",
        unitPrice: "1000",
        accountId: W.sales,
        taxCodeId: W.taxCodeExempt,
      },
    ],
  });
  await postInvoice(
    actor,
    id,
    (await getDraft(actor, id))!.revision,
    "2026-01-01",
  );
  return id;
}
async function pay(id: string, reference: string, date = "2026-01-02") {
  return recordReceipt(
    actor,
    {
      invoiceId: id,
      amountCents: "100",
      expectedOpenCents: String(await getInvoiceOpenCents(actor, id)),
      date,
      accountId: W.bank,
      method: "EFT",
      reference,
      memo: "Private searchable note",
    },
    { now },
  );
}
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query(
    "INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PAYMENT_RECEIVED',1,'E-',5),($1,'PAYMENT_SENT',1,'D-',5)",
    [W.companyA],
  );
  await db.query("UPDATE contact SET display_name=$2 WHERE id=$1", [
    W.customer,
    "Source%_\\Nord",
  ]);
  source = await invoice(W.customer);
  for (let i = 0; i < 27; i++)
    receipts.push(
      await pay(source, `Batch ${i}`, i < 13 ? "2026-01-02" : "2026-01-03"),
    );
  const other = await invoice(W.otherCustomer);
  await pay(other, "Ref%_\\tag");
  await pay(other, "RefXXtag");
  await voidReceipt(actor, receipts[0]!.id, {
    date: "2026-01-20",
    reason: "Correction",
  });
  const original = (await getInvoice(actor, source))!;
  const creditId = await saveCreditDraft(actor, source, {
    issueDate: "2026-01-04",
    memo: "Refund fixture",
    lines: [{ lineId: original.lines[0]!.id, amount: "20" }],
  });
  await postCreditNote(
    actor,
    creditId,
    (await getCreditDraft(actor, creditId))!.revision,
    "2026-01-04",
    { applicationMode: "UNAPPLIED" },
  );
  refundId = (
    await recordCustomerRefund(
      actor,
      {
        creditNoteId: creditId,
        amountCents: "500",
        expectedOpenCents: "2000",
        date: "2026-01-05",
        accountId: W.bank,
        method: "EFT",
        reference: "Batch refund",
      },
      { now },
    )
  ).id;
});
afterAll(async () => {
  await db?.end();
});
it("searches literal text and JSON names without broad wildcard matching or internal notes", async () => {
  for (const q of ["%", "_", "\\"])
    expect((await listReceipts(reader, 1, { q })).total, q).toBe(28);
  expect((await listReceipts(reader, 1, { q: "Ref%" })).total).toBe(1);
  expect((await listReceipts(reader, 1, { q: "Ref_" })).total).toBe(0);
  expect((await listReceipts(reader, 1, { q: "\\tag" })).total).toBe(1);
  expect(
    (
      await listReceipts(reader, 1, { q: receipts[1]!.number.toLowerCase() })
    ).receipts.map((r) => r.id),
  ).toEqual([receipts[1]!.id]);
  expect(
    (await listReceipts(reader, 1, { q: "Private searchable note" })).total,
  ).toBe(0);
  expect(
    (await listCustomerRefunds(reader, 1, { q: "Batch" })).refunds.map(
      (r) => r.id,
    ),
  ).toEqual([refundId]);
  expect((await listCustomerRefunds(reader, 1, { q: "%" })).total).toBe(1);
});
it("filters inclusive payment dates/statuses and preserves whole-filter counts on every page", async () => {
  const filters = { q: "Batch", status: "POSTED" };
  const one = await listReceipts(reader, 1, filters),
    two = await listReceipts(reader, 2, filters);
  expect(one.total).toBe(26);
  expect(one.receipts).toHaveLength(25);
  expect(two.receipts).toHaveLength(1);
  expect(two.total).toBe(26);
  expect(two.pageCount).toBe(2);
  expect(
    new Set([...one.receipts, ...two.receipts].map((r) => r.id)).size,
  ).toBe(26);
  expect((await listReceipts(reader, 999, filters)).page).toBe(2);
  expect(
    await listReceipts(reader, 99, { q: "Batch", status: "VOID" }),
  ).toMatchObject({ total: 1, page: 1, pageCount: 1 });
  expect(
    (
      await listReceipts(reader, 1, {
        q: "Batch",
        from: "2026-01-03",
        to: "2026-01-03",
      })
    ).total,
  ).toBe(14);
  expect(
    (await listReceipts(reader, 1, { q: "Batch", to: "2026-01-02" })).total,
  ).toBe(13);
  expect((await listReceipts(reader, 1, { from: "2026-01-04" })).total).toBe(0);
  expect(
    (
      await listCustomerRefunds(reader, 1, {
        from: "2026-01-05",
        to: "2026-01-05",
        status: "POSTED",
      })
    ).total,
  ).toBe(1);
  await voidCustomerRefund(actor, refundId, {
    date: "2026-01-15",
    reason: "Correction",
  });
  expect(
    (
      await listCustomerRefunds(reader, 1, {
        from: "2026-01-05",
        to: "2026-01-05",
        status: "VOID",
      })
    ).total,
  ).toBe(1);
  expect(
    (await listCustomerRefunds(reader, 1, { from: "2026-01-15" })).total,
  ).toBe(0);
});
it("keeps frozen identities when Contacts is masked and explicitly requires accounting and sales", async () => {
  await db.query(
    "UPDATE contact SET display_name='New private name' WHERE id=$1",
    [W.customer],
  );
  await db.query(
    "UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",
    [
      W.companyA,
      W.userReader,
      JSON.stringify({ contacts: "none", sales: "read", accounting: "read" }),
    ],
  );
  expect((await listReceipts(reader, 1, { q: "Source%" })).total).toBe(27);
  expect((await getReceipt(reader, receipts[1]!.id))?.customer).toBe(
    "Source%_\\Nord",
  );
  expect((await listReceipts(reader, 1, { q: "New private name" })).total).toBe(
    0,
  );
  await expect(getContact(reader, W.customer)).rejects.toThrow();
  for (const moduleKey of ["sales", "accounting"]) {
    await db.query(
      "UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",
      [W.companyA, W.userReader, JSON.stringify({ [moduleKey]: "none" })],
    );
    await expect(listReceipts(reader)).rejects.toMatchObject({
      key: "forbidden",
    });
    await expect(getReceipt(reader, receipts[1]!.id)).rejects.toMatchObject({
      key: "forbidden",
    });
    await expect(listCustomerRefunds(reader)).rejects.toMatchObject({
      key: "forbidden",
    });
  }
  await db.query(
    "UPDATE membership SET module_access='{}'::jsonb WHERE company_id=$1 AND user_id=$2",
    [W.companyA, W.userReader],
  );
  const foreign = { userId: W.userOwnerB, companyId: W.companyB };
  expect((await listReceipts(foreign, 1, { q: "%" })).total).toBe(0);
  expect((await listCustomerRefunds(foreign, 1, { q: "Batch" })).total).toBe(0);
  expect(await getReceipt(foreign, receipts[1]!.id)).toBeNull();
});
it("rejects malformed filters instead of silently broadening them", async () => {
  for (const filters of [
    { q: ["Batch", ""] },
    { status: "invalid" },
    { from: "2026-02-30" },
    { from: "2026-02-01", to: "2026-01-01" },
    { q: "\u0000" },
    { q: "x".repeat(121) },
  ]) {
    await expect(listReceipts(reader, 1, filters)).rejects.toMatchObject({
      key: "payments.invalidFilters",
    });
    await expect(listCustomerRefunds(reader, 1, filters)).rejects.toMatchObject(
      { key: "payments.invalidFilters" },
    );
  }
});
it("retains a visible legacy customer without a required Contact join or an extra permission grant", async () => {
  const client = await appClient(),
    id = randomUUID(),
    journalId = randomUUID();
  try {
    await inContext(
      client,
      asOwnerA,
      async () => {
        const n = (
          await client.query(
            "UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=$1 AND key='JOURNAL_ENTRY' RETURNING next_value-1 AS n",
            [W.companyA],
          )
        ).rows[0].n;
        await entry(client, {
          id: journalId,
          no: Number(n),
          date: "2026-01-01",
          source: "PAYMENT",
          sourceId: id,
        });
        await line(client, journalId, 1, W.bank, { debit: 100 });
        await line(client, journalId, 2, W.receivable, {
          credit: 100,
          contact: W.otherCustomer,
        });
        await client.query(
          "INSERT INTO payment(id,company_id,number,direction,ledger,contact_id,payment_date,amount_cents,account_id,method,journal_entry_id,created_by_id,updated_at) VALUES($1,$2,'Legacy-1','RECEIVED','RECEIVABLE',$3,'2026-01-01',100,$4,'EFT',$5,$6,now())",
          [id, W.companyA, W.otherCustomer, W.bank, journalId, W.userOwnerA],
        );
      },
      { commit: true },
    );
  } finally {
    await client.end();
  }
  expect((await getReceipt(actor, id))?.customer).toBe("Autre Client");
  await db.query(
    "UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",
    [W.companyA, W.userReader, JSON.stringify({ contacts: "none" })],
  );
  expect((await getReceipt(reader, id))?.customer).toBe("");
  expect(
    (await listReceipts(reader, 1, { q: "Legacy-1" })).receipts[0]?.customer,
  ).toBe("");
  expect((await listReceipts(reader, 1, { q: "Autre Client" })).total).toBe(2);
});
