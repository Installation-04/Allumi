import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import type pg from "pg";
import { amountInput } from "@/modules/payments";
import { saveDraft, getDraft, postInvoice, voidInvoice } from "@/modules/sales";
import {
  getCustomerStatement,
  getCustomerStatementExport,
  listStatementCustomers,
} from "@/modules/reports";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
let db: pg.Client;
async function post(
  date: string,
  cents: bigint,
  contactId: string = W.customer,
) {
  const id = await saveDraft(actor, {
    contactId,
    issueDate: date,
    dueDate: date,
    memo: "Internal confidential note",
    lines: [
      {
        description: "Statement fixture",
        quantity: "1",
        unitPrice: amountInput(cents, "en"),
        accountId: W.sales,
        taxCodeId: W.taxCodeExempt,
      },
    ],
  });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, date);
  return { id };
}
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query(
    "INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5)",
    [W.companyA],
  );
});
afterAll(async () => {
  await db?.end();
});
it("carries opening and running balances across pages in journal order and exports every movement", async () => {
  await post("2026-05-31", 1234n);
  const first = await post("2026-06-01", 800n);
  for (let i = 0; i < 103; i++) await post("2026-06-02", BigInt(i + 1));
  await voidInvoice(actor, first.id, "2026-06-30", "Private reversal reason");
  await post("2026-07-01", 999n);
  await post("2026-06-05", 777n, W.otherCustomer);
  const period = {
    contactId: W.customer,
    from: "2026-06-01",
    to: "2026-06-30",
  };
  const one = await getCustomerStatement(actor, period),
    two = await getCustomerStatement(actor, { ...period, page: 2 });
  expect(one).toMatchObject({
    openingCents: 1234n,
    debitCents: 6156n,
    creditCents: 800n,
    closingCents: 6590n,
    lineCount: 105,
    pageCount: 2,
  });
  expect(one.rows).toHaveLength(100);
  expect(two.rows).toHaveLength(5);
  const all = await getCustomerStatementExport(actor, period);
  expect(all.rows.map((r) => r.id)).toEqual(
    [...one.rows, ...two.rows].map((r) => r.id),
  );
  expect(all.rows.at(-1)).toMatchObject({
    kind: "REVERSAL",
    balanceCents: 6590n,
  });
  expect(all.rows[0]).toMatchObject({ kind: "INVOICE", balanceCents: 2034n });
  expect(
    all.rows.every(
      (r, i) =>
        i === 0 ||
        r.balanceCents ===
          all.rows[i - 1]!.balanceCents + r.debitCents - r.creditCents,
    ),
  ).toBe(true);
  expect(
    (await getCustomerStatement(actor, { ...period, page: 999 })).page,
  ).toBe(2);
  await expect(
    getCustomerStatementExport(actor, period, { maxLines: 104 }),
  ).rejects.toMatchObject({ key: "reports.tooManyLines" });
  expect(
    JSON.stringify(all, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  ).not.toMatch(/Internal confidential|Private reversal/);
  const empty = await getCustomerStatement(actor, {
    ...period,
    from: "2026-06-10",
    to: "2026-06-20",
  });
  expect(empty).toMatchObject({
    openingCents: 7390n,
    closingCents: 7390n,
    lineCount: 0,
  });
});
it("bounds customer lookup, escapes wildcard searches and excludes suppliers", async () => {
  for (let i = 0; i < 102; i++)
    await db.query(
      "INSERT INTO contact(id,company_id,is_customer,display_name,updated_at) VALUES($1,$2,true,$3,now())",
      [
        randomUUID(),
        W.companyA,
        `Search fixture ${String(i).padStart(3, "0")}`,
      ],
    );
  const found = await listStatementCustomers(actor, "Search fixture");
  expect(found.contacts).toHaveLength(100);
  expect(found.hasMore).toBe(true);
  expect(
    (await listStatementCustomers(actor, "Search fixture 101")).contacts,
  ).toHaveLength(1);
  expect((await listStatementCustomers(actor, "%")).contacts).toHaveLength(0);
  expect(
    (await listStatementCustomers(actor)).contacts.map((c) => c.id),
  ).not.toContain(W.supplier);
  const range = { contactId: W.customer, from: "2026-06-01", to: "2026-06-30" };
  const before = await getCustomerStatement(actor, range);
  await db.query(
    "UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1",
    [W.companyA, W.userOwnerA],
  );
  await db.query(
    "UPDATE fiscal_year SET status='CLOSED',closed_at=now(),closed_by_id=$2 WHERE company_id=$1",
    [W.companyA, W.userOwnerA],
  );
  expect(await getCustomerStatement(actor, range)).toEqual(before);

  await expect(
    getCustomerStatement(
      { userId: W.userOwnerB, companyId: W.companyB },
      { contactId: W.customer, from: "2026-01-01", to: "2026-12-31" },
    ),
  ).rejects.toMatchObject({ key: "reports.contact" });
});
