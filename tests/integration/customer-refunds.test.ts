import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import {
  getDraft,
  getInvoice,
  getInvoiceOpenCents,
  getCreditDraft,
  getCreditOpenCents,
  getPostedCredit,
  postInvoice,
  postCreditNote,
  saveDraft,
  saveCreditDraft,
  voidCreditNote,
} from "@/modules/sales";
import {
  getCustomerRefund,
  listCreditRefunds,
  listCustomerRefunds,
  listCustomerRefundAccounts,
  recordCustomerRefund,
  recordReceipt,
  voidCustomerRefund,
} from "@/modules/payments";
import {
  getCustomerStatement,
  getCustomerStatementExport,
} from "@/modules/reports";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const other = { userId: W.userOwnerB, companyId: W.companyB };
const now = new Date("2026-12-31T12:00:00Z");
let db: pg.Client;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query(
    "INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PAYMENT_RECEIVED',1,'E-',5),($1,'PAYMENT_SENT',1,'R-',5)",
    [W.companyA],
  );
});
afterAll(async () => {
  await db?.end();
});
async function credit() {
  const invoiceId = await saveDraft(actor, {
    contactId: W.customer,
    issueDate: "2026-01-01",
    dueDate: "2026-02-01",
    lines: [
      {
        description: "Service",
        quantity: "1",
        unitPrice: "100",
        accountId: W.sales,
        taxCodeId: W.taxCodeStandard,
      },
    ],
  });
  await postInvoice(
    actor,
    invoiceId,
    (await getDraft(actor, invoiceId))!.revision,
    "2026-01-01",
  );
  const source = (await getInvoice(actor, invoiceId))!;
  await recordReceipt(
    actor,
    {
      invoiceId,
      amountCents: "11498",
      expectedOpenCents: "11498",
      date: "2026-01-05",
      accountId: W.bank,
      method: "EFT",
    },
    { now },
  );
  const id = await saveCreditDraft(actor, invoiceId, {
    issueDate: "2026-02-01",
    memo: "Private credit reason",
    lines: [{ lineId: source.lines[0]!.id, amount: "100" }],
  });
  const draft = (await getCreditDraft(actor, id))!;
  await expect(
    postCreditNote(actor, id, draft.revision, "2026-02-01"),
  ).rejects.toMatchObject({ key: "sales.creditBalance" });
  await postCreditNote(actor, id, draft.revision, "2026-02-01", {
    applicationMode: "UNAPPLIED",
  });
  expect(await getInvoiceOpenCents(actor, invoiceId)).toBe(0n);
  expect((await getPostedCredit(actor, id))!.creditsApplied).toHaveLength(0);
  expect(await getCreditOpenCents(actor, id)).toBe(11498n);
  return id;
}
const input = (creditNoteId: string, extra = {}) => ({
  creditNoteId,
  amountCents: "11498",
  expectedOpenCents: "11498",
  date: "2026-02-10",
  accountId: W.bank,
  method: "EFT",
  reference: "Refund 42",
  memo: "Internal payment note",
  ...extra,
});
it("refunds a paid invoice's exact source-linked credit, preserves history and dated AR balances", async () => {
  const id = await credit();
  const refund = await recordCustomerRefund(
    actor,
    input(id, { amountCents: "5000" }),
    { now },
  );
  const detail = (await getCustomerRefund(reader, refund.id))!;
  expect(detail).toMatchObject({
    status: "POSTED",
    customer: "Client Fictif",
    amountCents: 5000n,
    date: "2026-02-10",
  });
  expect(detail.allocations).toEqual([
    expect.objectContaining({
      creditNoteId: id,
      amountCents: 5000n,
      unappliedDate: null,
    }),
  ]);
  const lines = (
    await db.query(
      "SELECT account_id,debit_cents::text,credit_cents::text,contact_id FROM journal_line WHERE entry_id=$1 ORDER BY line_no",
      [detail.journalEntryId],
    )
  ).rows;
  expect(lines).toEqual([
    {
      account_id: W.bank,
      debit_cents: "0",
      credit_cents: "5000",
      contact_id: null,
    },
    {
      account_id: W.receivable,
      debit_cents: "5000",
      credit_cents: "0",
      contact_id: W.customer,
    },
  ]);
  expect(await getCreditOpenCents(actor, id)).toBe(6498n);
  await expect(
    voidCreditNote(actor, id, "2026-02-20", "Correction"),
  ).rejects.toThrow();
  await expect(
    voidCustomerRefund(actor, refund.id, {
      date: "2026-02-09",
      reason: "Correction",
    }),
  ).rejects.toMatchObject({ key: "refunds.invalidVoid" });
  await voidCustomerRefund(actor, refund.id, {
    date: "2026-02-20",
    reason: "Correction",
  });
  await voidCustomerRefund(actor, refund.id, {
    date: "2026-02-20",
    reason: "Correction",
  });
  expect(await getCreditOpenCents(actor, id)).toBe(11498n);
  expect((await listCreditRefunds(reader, id))[0]).toMatchObject({
    paymentId: refund.id,
    unappliedDate: "2026-02-20",
  });
  expect(
    (await getCustomerRefund(reader, refund.id))!.allocations[0]?.unappliedDate,
  ).toBe("2026-02-20");
  await expect(
    recordCustomerRefund(actor, input(id, { date: "2026-02-19" }), { now }),
  ).rejects.toMatchObject({ key: "refunds.dateBeforeMovement" });
  const period = {
    contactId: W.customer,
    from: "2026-02-01",
    to: "2026-02-15",
  };
  const statement = await getCustomerStatement(reader, period);
  expect(statement).toMatchObject({
    openingCents: 0n,
    debitCents: 5000n,
    creditCents: 11498n,
    closingCents: -6498n,
    lineCount: 2,
  });
  expect(statement.rows.map((r) => r.kind)).toEqual(["CREDIT_NOTE", "REFUND"]);
  expect(statement.rows.map((r) => r.balanceCents)).toEqual([-11498n, -6498n]);
  expect(
    JSON.stringify(statement, (_, v) =>
      typeof v === "bigint" ? String(v) : v,
    ),
  ).not.toMatch(/Private credit reason|Internal payment note/);
  const after = await getCustomerStatementExport(reader, {
    ...period,
    to: "2026-02-28",
  });
  expect(after.closingCents).toBe(-11498n);
  expect(after.rows.at(-1)?.kind).toBe("REVERSAL");
  await expect(
    getCustomerStatementExport(
      reader,
      { ...period, to: "2026-02-28" },
      { maxLines: 2 },
    ),
  ).rejects.toMatchObject({ key: "reports.tooManyLines" });
});
it("serializes duplicate forms and refuses wrong accounts, dates, balances and companies without side effects", async () => {
  const id = await credit();
  for (const [extra, key] of [
    [{ amountCents: "0" }, "invalid"],
    [{ amountCents: "11499" }, "exceeds"],
    [{ expectedOpenCents: "1" }, "stale"],
    [{ date: "2026-01-31" }, "dateBeforeCredit"],
    [{ date: "2027-01-01" }, "futureDate"],
    [{ accountId: W.undeposited }, "account"],
    [{ accountId: W.bankB }, "account"],
  ] as const) {
    await expect(
      recordCustomerRefund(actor, input(id, extra), { now }),
    ).rejects.toMatchObject({ key: `refunds.${key}` });
  }
  await expect(
    recordCustomerRefund(reader, input(id), { now }),
  ).rejects.toMatchObject({ key: "forbidden" });
  await expect(
    recordCustomerRefund(other, input(id), { now }),
  ).rejects.toThrow();
  const results = await Promise.allSettled(
    [1, 2, 3].map(() => recordCustomerRefund(actor, input(id), { now })),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await getCreditOpenCents(actor, id)).toBe(0n);
  const result = results.find((r) => r.status === "fulfilled")!;
  if (result.status !== "fulfilled") throw new Error("missing refund");
  expect(await getCustomerRefund(other, result.value.id)).toBeNull();
  expect((await listCustomerRefunds(other)).total).toBe(0);
  await expect(
    voidCustomerRefund(reader, result.value.id, {
      date: "2026-02-20",
      reason: "Correction",
    }),
  ).rejects.toMatchObject({ key: "forbidden" });
  expect(
    (await listCustomerRefundAccounts(actor)).map((a) => a.id),
  ).not.toContain(W.undeposited);
  await db.query(
    "UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",
    [W.companyA, W.userAccountant, JSON.stringify({ contacts: "none" })],
  );
  const accountant = { ...actor, userId: W.userAccountant };
  expect((await getCustomerRefund(accountant, result.value.id))!.customer).toBe(
    "Client Fictif",
  );
  expect(
    (await listCustomerRefunds(accountant)).refunds.find(
      (r) => r.id === result.value.id,
    )?.customer,
  ).toBe("Client Fictif");
  await db.query(
    "UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",
    [
      W.companyA,
      W.userReader,
      JSON.stringify({ sales: "write", accounting: "read" }),
    ],
  );
  await expect(
    recordCustomerRefund(reader, input(id), { now }),
  ).rejects.toMatchObject({ key: "forbidden" });
  await db.query(
    "UPDATE membership SET module_access='{}'::jsonb WHERE company_id=$1 AND user_id=$2",
    [W.companyA, W.userReader],
  );
});
it("rejects invalid statement scope instead of returning all customers and enforces every module", async () => {
  for (const contactId of [W.bankB, W.supplier, "invalid"])
    await expect(
      getCustomerStatement(reader, {
        contactId,
        from: "2026-01-01",
        to: "2026-03-01",
      }),
    ).rejects.toMatchObject({ key: "reports.contact" });
  await expect(
    getCustomerStatement(reader, {
      contactId: W.customer,
      from: "2026-02-30",
      to: "2026-03-01",
    }),
  ).rejects.toMatchObject({ key: "reports.period" });
  for (const moduleKey of ["sales", "accounting", "contacts"]) {
    await db.query(
      "UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",
      [W.companyA, W.userReader, JSON.stringify({ [moduleKey]: "none" })],
    );
    await expect(
      getCustomerStatement(reader, {
        contactId: W.customer,
        from: "2026-01-01",
        to: "2026-03-01",
      }),
    ).rejects.toThrow();
  }
  await db.query(
    "UPDATE membership SET module_access='{}'::jsonb WHERE company_id=$1 AND user_id=$2",
    [W.companyA, W.userReader],
  );
  await db.query("UPDATE contact SET is_active=false WHERE id=$1", [
    W.customer,
  ]);
  expect(
    (
      await getCustomerStatement(reader, {
        contactId: W.customer,
        from: "2026-01-01",
        to: "2026-03-01",
      })
    ).contact.isActive,
  ).toBe(false);
});
