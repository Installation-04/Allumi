import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type pg from "pg";
import { getInvoiceReminder, listInvoiceReminders, sendInvoiceReminder, sendInvoiceEmail, saveDraft, getDraft, postInvoice, voidInvoice, getInvoiceEmails } from "@/modules/sales";
import { recordReceipt } from "@/modules/payments";
import { todayIso } from "@/modules/ledger";
import { withCompany } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const mail = vi.hoisted(() => ({ deliver: vi.fn().mockResolvedValue("ACCEPTED"), configured: vi.fn() }));
vi.mock("@/platform/mail", () => ({ deliverMail: mail.deliver, requireMailConfigured: mail.configured, mailConfigured: () => true }));
const actor = { userId: W.userOwnerA, companyId: W.companyA };
let db: pg.Client;
beforeAll(async () => { db = await owner(); await seedWorld(db); await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'PAYMENT_RECEIVED',1,'E-',5)", [W.companyA]); });
afterAll(async () => { await db?.end(); });
async function invoice(dueDate: string = "2026-06-02", posted = true) {
  const id = await saveDraft(actor, { contactId: W.customer, issueDate: "2026-06-01", dueDate, memo: "PRIVATE INTERNAL MARKER", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
  if (posted) await postInvoice(actor, id, (await getDraft(actor, id))!.revision, "2026-06-01");
  return id;
}
const input = (balance = "11498") => ({ attemptId: randomUUID(), recipient: "client@example.test", locale: "fr-CA" as const, confirmResend: false, expectedOpenCents: balance, expectedDate: todayIso(), expectedDueDate: "2026-06-02" });

it("lists only current overdue positive balances, with literal snapshot search and pagination", async () => {
  const id = await invoice(), draft = await invoice("2026-06-02", false), future = await invoice("2099-12-31");
  const paid = await invoice(); await recordReceipt(actor, { invoiceId: paid, amountCents: "11498", expectedOpenCents: "11498", date: "2026-06-02", accountId: W.bank, method: "EFT" });
  const list = await listInvoiceReminders(actor);
  expect(list.rows.map(r => r.id)).toContain(id);
  for (const hidden of [draft, future, paid]) expect(list.rows.map(r => r.id)).not.toContain(hidden);
  expect((await listInvoiceReminders(actor, { q: "%_\\" })).rows).toEqual([]);
  const number = (await getInvoiceReminder(actor, id, "en"))!.number;
  expect((await listInvoiceReminders(actor, { q: number })).rows.map(r => r.id)).toEqual([id]);
  expect((await listInvoiceReminders(actor, { page: 1000 })).rows).toEqual([]);
  for (const bad of [{ page: 0 }, { q: "\0" }, { page: 1001 }]) await expect(listInvoiceReminders(actor, bad)).rejects.toMatchObject({ key: "reminders.invalid" });
});
it("previews frozen names and the remaining balance without private notes, then refuses stale or paid forms", async () => {
  const id = await invoice(), preview = (await getInvoiceReminder(actor, id, "en"))!;
  await db.query("UPDATE contact SET display_name='Renamed after posting' WHERE id=$1", [W.customer]);
  expect((await getInvoiceReminder(actor, id, "en"))!.customer).toBe(preview.customer);
  expect(preview.message.text).toContain("114.98"); expect(preview.message.text).not.toContain("PRIVATE INTERNAL MARKER"); expect(preview.message.html).not.toContain("/c/");
  const before = mail.deliver.mock.calls.length;
  await recordReceipt(actor, { invoiceId: id, amountCents: "500", expectedOpenCents: "11498", date: "2026-06-02", accountId: W.bank, method: "EFT" });
  await expect(sendInvoiceReminder(actor, id, input())).rejects.toMatchObject({ key: "reminders.stale" });
  expect((await getInvoiceReminder(actor, id, "fr-CA"))!.openCents).toBe(10998n);
  await expect(sendInvoiceReminder(actor, id, { ...input("10998"), expectedDate: "2000-01-01" })).rejects.toMatchObject({ key: "reminders.stale" });
  await recordReceipt(actor, { invoiceId: id, amountCents: "10998", expectedOpenCents: "10998", date: "2026-06-02", accountId: W.bank, method: "EFT" });
  expect(await getInvoiceReminder(actor, id, "en")).toBeNull();
  await expect(sendInvoiceReminder(actor, id, input("10998"))).rejects.toMatchObject({ key: "reminders.unavailable" });
  expect(mail.deliver.mock.calls.length).toBe(before); expect((await getInvoiceEmails(actor, id)).attempts).toHaveLength(0);
});
it("sends a concurrent replay once, records reminded balance, and separates invoice and reminder identities", async () => {
  const id = await invoice(), request = input(), before = mail.deliver.mock.calls.length;
  const [a, b] = await Promise.all([sendInvoiceReminder(actor, id, request), sendInvoiceReminder(actor, id, request)]);
  expect(a.id).toBe(b.id); expect(mail.deliver.mock.calls.length).toBe(before + 1);
  expect((await getInvoiceEmails(actor, id)).attempts[0]).toMatchObject({ purpose: "REMINDER", reminderCents: 11498n, status: "ACCEPTED" });
  expect(mail.deliver.mock.calls.at(-1)![0].text).toContain("114,98");
  await expect(sendInvoiceEmail(actor, id, request)).rejects.toMatchObject({ key: "invoiceEmail.invalid" });
  await expect(sendInvoiceReminder(actor, id, { ...request, expectedOpenCents: "1" })).rejects.toMatchObject({ key: "reminders.invalid" });
  await expect(sendInvoiceReminder(actor, id, input())).rejects.toMatchObject({ key: "invoiceEmail.confirmResend" });
  await expect(sendInvoiceReminder(actor, id, { ...input(), confirmResend: true })).rejects.toMatchObject({ key: "invoiceEmail.rate" });
  await expect(withCompany(actor, tx => tx.$executeRaw`UPDATE invoice_email SET reminder_cents=1 WHERE id=${a.id}::uuid`)).rejects.toThrow();
});
it("requires sales write and accounting read, isolates tenants and validates recipients before SMTP", async () => {
  const id = await invoice(), before = mail.deliver.mock.calls.length, reader = { ...actor, userId: W.userReader };
  await expect(sendInvoiceReminder(reader, id, input())).rejects.toThrow();
  await expect(getInvoiceReminder({ userId: W.userOwnerB, companyId: W.companyB }, id, "en")).resolves.toBeNull();
  await expect(sendInvoiceReminder({ userId: W.userOwnerB, companyId: W.companyB }, id, input())).rejects.toThrow();
  await expect(sendInvoiceReminder(actor, id, { ...input(), recipient: "a@example.test\r\nBcc: b@example.test" })).rejects.toMatchObject({ key: "reminders.invalid" });
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify({ sales: "write", accounting: "none" })]);
  const seller = { ...actor, userId: W.userAccountant };
  await expect(listInvoiceReminders(seller)).rejects.toThrow(); await expect(sendInvoiceReminder(seller, id, input())).rejects.toThrow();
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify({ sales: "write", accounting: "read", contacts: "none", taxes: "none" })]);
  expect((await listInvoiceReminders(seller)).rows.map(r => r.id)).toContain(id);
  expect((await getInvoiceReminder(seller, id, "en"))?.openCents).toBe(11498n);
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify({ sales: "write", accounting: "none" })]);
  expect(mail.deliver.mock.calls.length).toBe(before);
});
it("shares throttling between invoice emails and reminders under distinct concurrent requests", async () => {
  const id = await invoice(), before = mail.deliver.mock.calls.length;
  const results = await Promise.allSettled([sendInvoiceEmail(actor, id, { ...input(), confirmResend: true }), sendInvoiceReminder(actor, id, { ...input(), confirmResend: true })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { key: "invoiceEmail.rate" } });
  expect(mail.deliver.mock.calls.length).toBe(before + 1);
});
it("enforces fresh balance, date, accounting permission and positive reminder shape in SQL", async () => {
  const id = await invoice();
  const raw = (data: object, userId: string = actor.userId) => withCompany({ ...actor, userId }, tx => tx.invoiceEmail.create({ data: { id: randomUUID(), companyId: actor.companyId, documentId: id, recipient: "client@example.test", locale: "en", createdById: userId, purpose: "REMINDER", reminderCents: 11498n, reminderDate: new Date(`${todayIso()}T00:00:00Z`), ...data } }));
  for (const bad of [{ reminderCents: 1n }, { reminderCents: 0n }, { reminderCents: null }, { reminderDate: new Date("2000-01-01") }, { purpose: "INVOICE" }]) await expect(raw(bad)).rejects.toThrow();
  await expect(raw({}, W.userAccountant)).rejects.toThrow();
  const future = await invoice("2099-12-31"); await expect(raw({ documentId: future })).rejects.toThrow();
  await expect(raw({})).resolves.toMatchObject({ purpose: "REMINDER", reminderCents: 11498n });
});
it("retains uncertainty without retry and refuses void invoices or unavailable SMTP", async () => {
  const id = await invoice(); mail.configured.mockImplementationOnce(() => { throw new Error("unconfigured"); });
  await expect(sendInvoiceReminder(actor, id, input())).rejects.toThrow("unconfigured");
  expect((await getInvoiceEmails(actor, id)).attempts).toHaveLength(0);
  mail.deliver.mockResolvedValueOnce("UNKNOWN"); const request = { ...input(), locale: "en" as const };
  expect((await sendInvoiceReminder(actor, id, request)).status).toBe("UNKNOWN");
  const before = mail.deliver.mock.calls.length;
  expect((await sendInvoiceReminder(actor, id, request)).status).toBe("UNKNOWN"); expect(mail.deliver.mock.calls.length).toBe(before);
  expect(mail.deliver.mock.calls.at(-1)![0].subject).toContain("Payment reminder");
  await voidInvoice(actor, id, "2026-06-03", "Cancelled fixture");
  expect(await getInvoiceReminder(actor, id, "en")).toBeNull(); await expect(sendInvoiceReminder(actor, id, input())).rejects.toThrow();
});
