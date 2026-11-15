import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { exportDisbursements, getDisbursement, listDisbursements, recordDisbursement, voidDisbursement } from "@/modules/payments";
import { saveDraft, getDraft, postBill } from "@/modules/purchases";
import { getContact } from "@/modules/contacts";
import { csvFormatFor, toCsv } from "@/modules/reports";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";

const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
let db: pg.Client;
const payments: { id: string; number: string }[] = [];
beforeAll(async () => {
  db = await owner(); await seedWorld(db);
  await db.query("UPDATE contact SET display_name=$2 WHERE id=$1", [W.supplier, "Supplier%_\\Nord"]);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5),($1,'PAYMENT_SENT',1,'D-',5)", [W.companyA]);
  const id = await saveDraft(actor, { contactId: W.supplier, documentDate: "2026-06-01", dueDate: "2026-07-01", lines: [{ description: "Supplies", quantity: "1", unitPrice: "100", accountId: W.expenses, taxCodeId: W.taxCodeStandard }] });
  await postBill(actor, id, (await getDraft(actor, id))!.revision, "2026-06-01");
  for (let i = 0; i < 27; i++) payments.push(await recordDisbursement(actor, { billId: id, amountCents: "1", expectedOpenCents: String(11498-i), date: i === 0 ? "2026-06-02" : "2026-06-03", accountId: W.bank, method: "EFT", reference: i === 0 ? "=HYPERLINK(test)" : `GROUP-${i}`, memo: "INTERNAL-DO-NOT-EXPORT" }, { now: new Date("2026-12-31") }));
  await voidDisbursement(actor, payments[0]!.id, { date: "2026-06-04", reason: "PRIVATE-VOID-REASON" });
});
afterAll(async () => { await db?.end(); });

it("searches literal snapshot names, payment numbers and references with inclusive original-date and current-status filters", async () => {
  expect((await listDisbursements(reader, 1, { q: "%_\\" })).total).toBe(27);
  expect((await listDisbursements(reader, 1, { q: "missing%" })).total).toBe(0);
  expect((await listDisbursements(reader, 1, { q: payments[0]!.number })).total).toBe(1);
  expect((await listDisbursements(reader, 1, { q: "group-", from: "2026-06-03", to: "2026-06-03", status: "POSTED" })).total).toBe(26);
  expect((await listDisbursements(reader, 1, { from: "2026-06-02", to: "2026-06-02", status: "VOID" })).total).toBe(1);
  expect((await listDisbursements(reader, 1, { from: "2026-06-04" })).total).toBe(0);
  expect((await listDisbursements(reader, 1, { q: "INTERNAL-DO-NOT-EXPORT" })).total).toBe(0);
  expect((await listDisbursements(reader, 1, { q: "PRIVATE-VOID-REASON" })).total).toBe(0);
});

it("paginates without duplicates and exports all filtered pages with exact original amounts and current statuses", async () => {
  const first = await listDisbursements(reader, 1, { q: "Supplier" });
  const last = await listDisbursements(reader, 2, { q: "Supplier" });
  expect(first.receipts).toHaveLength(25); expect(last.receipts).toHaveLength(2);
  expect(new Set([...first.receipts, ...last.receipts].map(row => row.id)).size).toBe(27);
  const before = (await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n;
  const rows = await exportDisbursements(reader, { q: "Supplier" });
  expect(rows).toHaveLength(27);
  expect(rows.every(row => row.amountCents === 1n)).toBe(true);
  expect(rows.filter(row => row.status === "VOID")).toHaveLength(1);
  expect(rows.every(row => !('memo' in row) && !('voidReason' in row) && !('contactId' in row))).toBe(true);
  const csv = toCsv(rows.map(row => [row.number, row.supplier, row.amountCents, row.reference ?? ""]), csvFormatFor("en"));
  expect(csv).toContain("0.01"); expect(csv).toContain("'=HYPERLINK(test)");
  expect(csv).not.toContain("INTERNAL"); expect(csv).not.toContain("PRIVATE");
  await expect(exportDisbursements(reader, {}, { maxRows: 26 })).rejects.toMatchObject({ key: "disbursements.exportLimit" });
  await expect(exportDisbursements(reader, {}, { maxRows: 10001 })).rejects.toThrow();
  expect((await exportDisbursements(reader, { q: payments[0]!.number }, { maxRows: 1 }))).toHaveLength(1);
  expect((await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n).toBe(before);
});

it("preserves frozen supplier names without Contacts or Sales access and refuses accounting denial", async () => {
  await db.query("UPDATE contact SET display_name='New private name' WHERE id=$1", [W.supplier]);
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader, JSON.stringify({ contacts: "none", sales: "none", accounting: "read" })]);
  await expect(getContact(reader, W.supplier)).rejects.toThrow();
  expect((await listDisbursements(reader, 1, { q: "%_\\" })).receipts[0]!.supplier).toBe("Supplier%_\\Nord");
  expect((await getDisbursement(reader, payments[0]!.id))?.supplier).toBe("Supplier%_\\Nord");
  expect((await exportDisbursements(reader))[0]!.supplier).toBe("Supplier%_\\Nord");
  expect((await listDisbursements(reader, 1, { q: "New private name" })).total).toBe(0);
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader, JSON.stringify({ accounting: "none" })]);
  await expect(listDisbursements(reader)).rejects.toMatchObject({ key: "forbidden" });
  await expect(getDisbursement(reader, payments[0]!.id)).rejects.toMatchObject({ key: "forbidden" });
  await expect(exportDisbursements(reader)).rejects.toMatchObject({ key: "forbidden" });
});

it("keeps company boundaries for list, detail, search and export and rejects invalid filters", async () => {
  const other = { userId: W.userOwnerB, companyId: W.companyB };
  expect((await listDisbursements(other, 1, { q: payments[0]!.number })).total).toBe(0);
  expect(await getDisbursement(other, payments[0]!.id)).toBeNull();
  expect(await exportDisbursements(other)).toEqual([]);
  for (const filters of [{ q: ["a", "b"] }, { q: "\u0000" }, { status: "DRAFT" }, { from: "2026-06-31" }, { from: "2026-06-03", to: "2026-06-02" }]) {
    await expect(listDisbursements(actor, 1, filters)).rejects.toMatchObject({ key: "payments.invalidFilters" });
    await expect(exportDisbursements(actor, filters)).rejects.toMatchObject({ key: "payments.invalidFilters" });
  }
});
