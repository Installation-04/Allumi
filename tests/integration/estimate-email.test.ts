import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type pg from "pg";
import { saveEstimate, getEstimate, transitionEstimate, previewEstimateEmail, sendEstimateEmail, getEstimateEmails } from "@/modules/sales";
import { withCompany } from "@/platform/tenant";
import { todayIso } from "@/modules/ledger";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const mail = vi.hoisted(() => ({ deliver: vi.fn().mockResolvedValue("ACCEPTED"), configured: vi.fn() }));
vi.mock("@/platform/mail", () => ({ deliverMail: mail.deliver, requireMailConfigured: mail.configured, mailConfigured: () => true }));
const actor = { userId: W.userOwnerA, companyId: W.companyA }, seller = { ...actor, userId: W.userAccountant };
let db: pg.Client;
beforeAll(async () => { db = await owner(); await seedWorld(db); });
afterAll(async () => { vi.useRealTimers(); await db?.end(); });
async function estimate(finalize = true, validUntil = "2999-01-01") {
  const id = await saveEstimate(actor, { contactId: W.customer, issueDate: "2026-06-01", dueDate: validUntil, memo: "EST-PRIVATE-NOTE", terms: "Public terms <script>sample</script>", reference: "DEV REF", lines: [{ description: "Consultation <img>", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
  if (finalize) await transitionEstimate(actor, id, (await getEstimate(actor, id))!.revision, "SENT");
  return id;
}
const input = () => ({ attemptId: randomUUID(), recipient: "customer@example.test", locale: "fr-CA" as const, confirmResend: false });
it("previews frozen public details and tax codes without requiring Contacts, Accounting or Taxes", async () => {
  const id = await estimate(), frozen = (await getEstimate(actor, id))!;
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify({ sales: "write", contacts: "none", accounting: "none", taxes: "none" })]);
  await db.query("UPDATE contact SET display_name='New live name' WHERE id=$1", [W.customer]);
  await db.query("UPDATE company SET name='Changed issuer' WHERE id=$1", [W.companyA]);
  const journals = (await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n;
  for (const locale of ["fr-CA", "en"] as const) {
    const preview = (await previewEstimateEmail(seller, id, locale))!;
    expect(preview.message.text).toContain(frozen.customer); expect(preview.message.text).toContain(frozen.issuerSnapshot!.name);
    expect(preview.message.text).toContain(locale === "en" ? "114.98" : "114,98");
    expect(preview.message.text).toContain("Public terms"); expect(preview.message.text).not.toContain("EST-PRIVATE-NOTE"); expect(preview.message.html).not.toContain("/c/");
    for (const tax of frozen.taxes) expect(preview.message.text).toContain(tax.code);
    expect(preview.message.html).toContain("&lt;script&gt;"); expect(preview.message.html).not.toContain("<script>");
  }
  await sendEstimateEmail(seller, id, input());
  expect(mail.deliver.mock.calls.at(-1)![0].text).not.toContain("EST-PRIVATE-NOTE");
  expect((await getEstimate(actor, id))!.status).toBe("SENT");
  expect((await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n).toBe(journals);
});
it("refuses draft, accepted, declined, cancelled and expired estimates before SMTP", async () => {
  const before = mail.deliver.mock.calls.length, draft = await estimate(false);
  expect(await previewEstimateEmail(actor, draft, "en")).toBeNull();
  await expect(sendEstimateEmail(actor, draft, input())).rejects.toMatchObject({ key: "estimateEmail.unavailable" });
  for (const state of ["ACCEPTED", "DECLINED", "CANCELLED"] as const) {
    const id = await estimate(); await transitionEstimate(actor, id, (await getEstimate(actor, id))!.revision, state);
    expect(await previewEstimateEmail(actor, id, "en")).toBeNull(); await expect(sendEstimateEmail(actor, id, input())).rejects.toMatchObject({ key: "estimateEmail.unavailable" });
  }
  const expiring = await estimate(true, todayIso());
  try {
    const future = new Date(); future.setUTCDate(future.getUTCDate() + 2); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(future);
    expect(await previewEstimateEmail(actor, expiring, "en")).toBeNull(); await expect(sendEstimateEmail(actor, expiring, input())).rejects.toMatchObject({ key: "estimateEmail.unavailable" });
  } finally { vi.useRealTimers(); }
  expect(mail.deliver.mock.calls.length).toBe(before);
});
it("reserves a concurrent replay once and rejects changed identity or distinct rapid sends", async () => {
  const id = await estimate(), request = input(), before = mail.deliver.mock.calls.length;
  const [a, b] = await Promise.all([sendEstimateEmail(actor, id, request), sendEstimateEmail(actor, id, request)]);
  expect(a.id).toBe(b.id); expect(mail.deliver.mock.calls.length).toBe(before + 1);
  await expect(sendEstimateEmail(actor, id, { ...request, recipient: "other@example.test" })).rejects.toMatchObject({ key: "estimateEmail.invalid" });
  await expect(sendEstimateEmail(actor, id, input())).rejects.toMatchObject({ key: "estimateEmail.confirmResend" });
  await expect(sendEstimateEmail(actor, id, { ...input(), confirmResend: true })).rejects.toMatchObject({ key: "estimateEmail.rate" });
  const fresh = await estimate(), start = mail.deliver.mock.calls.length;
  const results = await Promise.allSettled([sendEstimateEmail(actor, fresh, { ...input(), confirmResend: true }), sendEstimateEmail(actor, fresh, { ...input(), confirmResend: true })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(mail.deliver.mock.calls.length).toBe(start + 1);
});
it("keeps uncertainty and permits an identical replay after a customer response without resending", async () => {
  const id = await estimate(), request = { ...input(), locale: "en" as const }; mail.deliver.mockResolvedValueOnce("UNKNOWN");
  expect((await sendEstimateEmail(actor, id, request)).status).toBe("UNKNOWN");
  await transitionEstimate(actor, id, (await getEstimate(actor, id))!.revision, "ACCEPTED", "EST-PRIVATE-DECISION");
  const before = mail.deliver.mock.calls.length;
  expect((await sendEstimateEmail(actor, id, request)).status).toBe("UNKNOWN"); expect(mail.deliver.mock.calls.length).toBe(before);
  expect((await getEstimateEmails(actor, id)).attempts[0]!.status).toBe("UNKNOWN");
  expect(mail.deliver.mock.calls.at(-1)![0].subject).toContain("Estimate DEV-"); expect(mail.deliver.mock.calls.at(-1)![0].text).not.toContain("EST-PRIVATE");
});
it("checks permissions, tenant boundaries, recipients and SMTP configuration before delivery", async () => {
  const id = await estimate(), before = mail.deliver.mock.calls.length;
  await expect(sendEstimateEmail({ ...actor, userId: W.userReader }, id, input())).rejects.toThrow();
  const other = { companyId: W.companyB, userId: W.userOwnerB };
  expect(await previewEstimateEmail(other, id, "en")).toBeNull(); expect((await getEstimateEmails(other, id)).attempts).toEqual([]);
  await expect(sendEstimateEmail(other, id, input())).rejects.toThrow();
  await expect(sendEstimateEmail(actor, id, { ...input(), recipient: "a@example.test\r\nBcc: b@example.test" })).rejects.toMatchObject({ key: "estimateEmail.invalid" });
  mail.configured.mockImplementationOnce(() => { throw new Error("unconfigured"); }); await expect(sendEstimateEmail(actor, id, input())).rejects.toThrow("unconfigured");
  expect((await getEstimateEmails(actor, id)).attempts).toHaveLength(0); expect(mail.deliver.mock.calls.length).toBe(before);
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify({ sales: "none", accounting: "write" })]);
  await expect(getEstimateEmails(seller, id)).rejects.toThrow(); expect(await withCompany(seller, tx => tx.estimateEmail.findMany())).toEqual([]);
});
it("enforces eligibility, author identity, immutable fields and outcome transitions in SQL", async () => {
  const id = await estimate(), draft = await estimate(false);
  const raw = (data: object) => withCompany(actor, tx => tx.estimateEmail.create({ data: { id: randomUUID(), companyId: actor.companyId, estimateId: id, recipient: "client@example.test", locale: "en", createdById: actor.userId, ...data } }));
  await expect(raw({ estimateId: draft })).rejects.toThrow(); await expect(raw({ createdById: W.userOwnerB })).rejects.toThrow();
  const row = await raw({ createdAt: new Date("2000-01-01") }); expect(row.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  await expect(raw({})).rejects.toThrow();
  await expect(withCompany(actor, tx => tx.$executeRaw`UPDATE estimate_email SET recipient='forged@example.test' WHERE id=${row.id}::uuid`)).rejects.toThrow();
  await withCompany(actor, tx => tx.estimateEmail.update({ where: { id: row.id }, data: { status: "FAILED", completedAt: new Date() } }));
  await expect(withCompany(actor, tx => tx.estimateEmail.update({ where: { id: row.id }, data: { status: "ACCEPTED", completedAt: new Date() } }))).rejects.toThrow();
  await expect(withCompany(actor, tx => tx.estimateEmail.delete({ where: { id: row.id } }))).rejects.toThrow();
});
