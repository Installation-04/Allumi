import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { PERSONAL_COLUMNS, RETAINED_COLUMNS, anonymizeContact, getContact, listContacts, saveContact, setContactActive } from "@/modules/contacts";
import { getDraft, getInvoice, postInvoice, saveDraft } from "@/modules/sales";
import { AppError } from "@/platform/errors";
import { hashPassword } from "@/modules/auth/service/crypto";
import { enableTotp, owner, PASSWORD } from "./helpers";
import { seedWorld, W } from "./world";

// Law 25 erasure of a contact. Each test file has its own database, so the owners of the shared world can enable
// two-factor authentication here without touching another file.
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const accountant = { ...actor, userId: W.userAccountant };
const reader = { ...actor, userId: W.userReader };
const otherOwner = { userId: W.userOwnerB, companyId: W.companyB };
const ok = { reason: "SUBJECT_REQUEST", confirm: "yes" };

const personal = {
  displayName: "Marie Tremblay-Gagnon", legalName: "Atelier Tremblay inc.", email: "marie.tremblay@exemple.test", phone: "514-555-0142",
  addressLine1: "1234 rue des Érables", addressLine2: "app. 7", city: "Saint-Hyacinthe", province: "QC", postalCode: "J2S 1A1",
  notes: "Préfère le courriel. Fille: Léa.",
};
// what must not survive anywhere in the audit trail once the contact is erased
const SECRETS = ["Tremblay", "marie.tremblay@exemple.test", "514-555-0142", "Érables", "Saint-Hyacinthe", "J2S 1A1", "Léa", "123456789RT0001", "1234567890TQ0001", "EXEMPT-77"];

let db: pg.Client;
let totpA: Awaited<ReturnType<typeof enableTotp>>;
let totpB: Awaited<ReturnType<typeof enableTotp>>;
// one authenticator step (30 s) per use: a code works once and only for a later step than the last accepted one
let step = 0;
const proofA = () => { const at = totpA.enrolledAt + ++step * 30_000; return { code: totpA.code(at), now: new Date(at) }; };

async function refusal(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { if (error instanceof AppError) return error.key; throw error; }
  throw new Error("expected a refusal");
}

/** A contact full of personal data, edited once so that its history holds several audit entries. */
async function newContact(label: string) {
  const contact = await saveContact(actor, { kind: "CUSTOMER", ...personal, displayName: `${personal.displayName} ${label}` });
  await db.query("UPDATE contact SET gst_number = '123456789RT0001', qst_number = '1234567890TQ0001', tax_exemption_number = 'EXEMPT-77' WHERE id = $1", [contact.id]);
  await saveContact(actor, { kind: "CUSTOMER", ...personal, displayName: `${personal.displayName} ${label}`, notes: `${personal.notes} (mis à jour)` }, contact.id);
  await setContactActive(actor, contact.id, false);
  return contact.id;
}

/** The audit entries about this contact whose text still holds a trace of the person. */
async function leaks(contactId: string): Promise<string[]> {
  const rows = await db.query("SELECT action FROM audit_log WHERE entity_id = $2 AND (before::text ~* $1 OR after::text ~* $1)", [SECRETS.join("|"), contactId]);
  return rows.rows.map((row) => row.action as string);
}

beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  // the fixtures' users carry a placeholder hash: enrolling an authenticator checks the password for real
  await db.query("UPDATE user_credential SET password_hash = $1", [await hashPassword(PASSWORD)]);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5)", [W.companyA]);
});
// the attempts at a code are counted per user: each test starts with a full budget (the limit has its own test)
beforeEach(async () => { await db.query("DELETE FROM rate_limit"); });
afterAll(async () => { await db?.end(); });

describe("contact anonymization (Law 25)", () => {
  it("is for the owner only, with two-factor authentication on", async () => {
    const id = await newContact("roles");
    expect(await refusal(anonymizeContact(accountant, id, ok, { code: "000000" }))).toBe("forbidden");
    expect(await refusal(anonymizeContact(reader, id, ok, { code: "000000" }))).toBe("forbidden");
    // the owner without an authenticator: a session cookie alone is not enough for something irreversible
    expect(await refusal(anonymizeContact(actor, id, ok, { code: "000000" }))).toBe("contacts.twoFactorRequired");
    expect(await leaks(id)).not.toEqual([]);
    expect((await db.query("SELECT anonymized_at, email FROM contact WHERE id = $1", [id])).rows[0]).toMatchObject({ anonymized_at: null, email: personal.email });
    totpA = await enableTotp(W.userOwnerA, "proprio@exemple.test");
    totpB = await enableTotp(W.userOwnerB, "proprio-b@exemple.test");
  });

  it("refuses a missing reason or confirmation, a wrong code, and does not touch the contact", async () => {
    const id = await newContact("refusals");
    const history = async () => (await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'contact'")).rows[0].n as number;
    const before = await history();
    expect(await refusal(anonymizeContact(actor, id, { reason: "SUBJECT_REQUEST" }, proofA()))).toBe("contacts.anonymizeInvalid");
    expect(await refusal(anonymizeContact(actor, id, { reason: "SUBJECT_REQUEST", confirm: "no" }, proofA()))).toBe("contacts.anonymizeInvalid");
    // a free-text reason would end up in the audit trail and could name the person: only the fixed list is accepted
    expect(await refusal(anonymizeContact(actor, id, { reason: "Marie Tremblay l'a demandé", confirm: "yes" }, proofA()))).toBe("contacts.anonymizeInvalid");
    expect(await refusal(anonymizeContact(actor, id, ok, { code: "000000", now: new Date(totpA.enrolledAt + 90_000) }))).toBe("contacts.codeInvalid");
    expect(await refusal(anonymizeContact(actor, id, ok, { code: "" }))).toBe("contacts.codeInvalid");
    expect((await db.query("SELECT anonymized_at, email FROM contact WHERE id = $1", [id])).rows[0]).toMatchObject({ anonymized_at: null, email: personal.email });
    // the refusals changed nothing on the contact and left no entry about it (a wrong code is the sign-in's own business)
    expect(await history()).toBe(before);
    expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action IN ('contact.anonymize', 'privacy.redact')")).rows[0].n).toBe(0);
  });

  it("clears the record and every trace of the person in the audit trail, and says so on the trail", async () => {
    const id = await newContact("erase");
    const history = (await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'contact' AND entity_id = $1", [id])).rows[0].n;
    expect(history).toBeGreaterThanOrEqual(4); // insert, the registration numbers, the edit, the archiving
    expect(await leaks(id)).not.toEqual([]);

    const { redactedRows } = await anonymizeContact(actor, id, ok, proofA());
    expect(redactedRows).toBeGreaterThanOrEqual(history); // the entry of the erasure itself counts

    // the record: no personal column left, the rest unchanged
    const row = (await db.query("SELECT * FROM contact WHERE id = $1", [id])).rows[0];
    expect(row).toMatchObject({ display_name: "Contact anonymisé", is_active: false, is_customer: true, company_id: W.companyA });
    expect(row.anonymized_at).toBeInstanceOf(Date);
    for (const column of PERSONAL_COLUMNS.filter((name) => name !== "display_name")) expect(row[column], column).toBeNull();
    // gone from lists and forms
    expect(await getContact(actor, id)).toBeNull();
    expect((await listContacts(actor, { q: "Gagnon erase", status: "ALL" })).total).toBe(0);
    expect(await refusal(saveContact(actor, { kind: "CUSTOMER", displayName: "Retour" }, id).then(() => undefined))).toBe("contacts.notFound");

    // the audit trail: nobody can read the person any more, in any entry
    expect(await leaks(id)).toEqual([]);
    // but the history is still there, row by row, without its personal keys
    const entries = (await db.query("SELECT action, before, after FROM audit_log WHERE entity_type = 'contact' AND entity_id = $1 AND action LIKE 'row.%' ORDER BY occurred_at, id", [id])).rows;
    expect(entries).toHaveLength(history + 1);
    // the entry of the erasure keeps what is not personal (the audit trail stores the keys that changed)
    expect(entries.at(-1)?.after).toHaveProperty("anonymized_at");
    for (const entry of entries) for (const side of [entry.before, entry.after]) for (const key of PERSONAL_COLUMNS) expect(side ?? {}, key).not.toHaveProperty(key);

    // who did it, when, why: without anything about the person
    const redaction = (await db.query("SELECT actor_user_id, after FROM audit_log WHERE action = 'privacy.redact' AND entity_id = $1", [id])).rows;
    expect(redaction).toEqual([{ actor_user_id: W.userOwnerA, after: { keys: [...PERSONAL_COLUMNS], rows: redactedRows } }]);
    const event = (await db.query("SELECT actor_user_id, company_id, after FROM audit_log WHERE action = 'contact.anonymize' AND entity_id = $1", [id])).rows;
    expect(event).toEqual([{ actor_user_id: W.userOwnerA, company_id: W.companyA, after: { reason: "SUBJECT_REQUEST" } }]);
  });

  it("works once: an anonymized contact is not found again and the code is not spent", async () => {
    const id = await newContact("twice");
    await anonymizeContact(actor, id, ok, proofA());
    const next = proofA();
    expect(await refusal(anonymizeContact(actor, id, ok, next))).toBe("contacts.notFound");
    // the stale form did not use up the code: it still opens the next anonymization
    const other = await newContact("twice-b");
    await anonymizeContact(actor, other, { reason: "RETENTION_ENDED", confirm: "yes" }, next);
    expect((await db.query("SELECT after FROM audit_log WHERE action = 'contact.anonymize' AND entity_id = $1", [other])).rows[0].after).toEqual({ reason: "RETENTION_ENDED" });
    expect(await refusal(anonymizeContact(actor, id, ok, { code: "000000" }))).toBe("contacts.notFound");
  });

  it("takes a recovery code, once", async () => {
    const id = await newContact("recovery");
    const recovery = totpA.recoveryCodes[0] ?? "";
    await anonymizeContact(actor, id, ok, { code: recovery, now: new Date(totpA.enrolledAt + 400 * 30_000) });
    const again = await newContact("recovery-b");
    expect(await refusal(anonymizeContact(actor, again, ok, { code: recovery, now: new Date(totpA.enrolledAt + 401 * 30_000) }))).toBe("contacts.codeInvalid");
    expect((await getContact(actor, again))?.email).toBe(personal.email);
  });

  it("limits the attempts at the code", async () => {
    const id = await newContact("limit");
    const at = new Date(totpA.enrolledAt + 500 * 30_000);
    const answers: string[] = [];
    for (let attempt = 0; attempt < 12; attempt++) answers.push(await refusal(anonymizeContact(actor, id, ok, { code: String(100_000 + attempt * 7), now: at })));
    expect(answers[0]).toBe("contacts.codeInvalid");
    expect(answers.at(-1)).toBe("contacts.rateLimited");
    expect((await getContact(actor, id))?.email).toBe(personal.email);
  });

  it("never reaches another company's contact", async () => {
    const id = await newContact("tenant");
    const at = totpB.enrolledAt + 30_000;
    expect(await refusal(anonymizeContact(otherOwner, id, ok, { code: totpB.code(at), now: new Date(at) }))).toBe("contacts.notFound");
    expect((await db.query("SELECT anonymized_at, email FROM contact WHERE id = $1", [id])).rows[0]).toMatchObject({ anonymized_at: null, email: personal.email });
  });

  it("erases once under concurrent requests", async () => {
    const id = await newContact("race");
    const results = await Promise.allSettled([anonymizeContact(actor, id, ok, proofA()), anonymizeContact(actor, id, ok, proofA())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((result) => result.status === "rejected");
    expect(lost?.status === "rejected" && lost.reason instanceof AppError).toBe(true);
    expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'contact.anonymize' AND entity_id = $1", [id])).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'privacy.redact' AND entity_id = $1", [id])).rows[0].n).toBe(1);
    expect(await leaks(id)).toEqual([]);
  });

  it("keeps the accounting documents: a posted invoice keeps its frozen copy of the customer", async () => {
    const customer = await saveContact(actor, { kind: "CUSTOMER", ...personal, displayName: "Cliente Conservée", country: "CA" });
    const draftId = await saveDraft(actor, { contactId: customer.id, issueDate: "2026-06-01", dueDate: "2026-07-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
    const invoiceId = await postInvoice(actor, draftId, (await getDraft(actor, draftId))!.revision, "2026-06-01");
    const before = await getInvoice(actor, invoiceId);

    await anonymizeContact(actor, customer.id, ok, proofA());

    const after = await getInvoice(actor, invoiceId);
    // the invoice, its numbers, its journal entry and its frozen billing copy are exactly as they were
    expect(after).toMatchObject({ number: before!.number, totalCents: before!.totalCents, journalEntryId: before!.journalEntryId, billingSnapshot: before!.billingSnapshot });
    expect(after!.billingSnapshot).toMatchObject({ name: "Cliente Conservée", email: personal.email });
    // the receivable line still points at the (now anonymous) contact
    expect((await db.query("SELECT count(*)::int AS n FROM journal_line WHERE entry_id = $1 AND contact_id = $2", [before!.journalEntryId, customer.id])).rows[0].n).toBe(1);
    expect((await db.query("SELECT display_name FROM contact WHERE id = $1", [customer.id])).rows[0].display_name).toBe("Contact anonymisé");
    // and nobody can start a new document for the erased contact
    await expect(saveDraft(actor, { contactId: customer.id, issueDate: "2026-06-02", dueDate: "2026-07-02", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] })).rejects.toThrow();
  });

  it("classifies every column of the contact table: a new column must be decided, not forgotten", async () => {
    const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contact'")).rows.map((row) => row.column_name as string);
    const classified = [...PERSONAL_COLUMNS, ...RETAINED_COLUMNS] as string[];
    expect(columns.filter((name) => !classified.includes(name)), "columns to classify as personal or retained").toEqual([]);
    expect(classified.filter((name) => !columns.includes(name)), "classified columns that do not exist").toEqual([]);
    expect(new Set(classified).size).toBe(classified.length);
  });
});
