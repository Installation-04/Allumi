import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { getContact, listContacts, saveContact, setContactActive } from "@/modules/contacts";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";

const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const accountant = { ...actor, userId: W.userAccountant };
const other = { userId: W.userOwnerB, companyId: W.companyB };
const input = { kind: "BOTH", displayName: "Atelier Boréal", email: "contact@example.test" };
let db: pg.Client;
beforeAll(async () => { db = await owner(); await seedWorld(db); });
afterAll(async () => { await db?.end(); });

describe("contact directory", () => {
  it("allows accountants to create, readers to read, and audits archive/restore without deleting", async () => {
    const contact = await saveContact(accountant, input);
    expect(contact).toMatchObject({ isCustomer: true, isSupplier: true, paymentTermsDays: 30 });
    expect(await getContact(reader, contact.id)).toMatchObject({ email: input.email });
    await expect(saveContact(reader, input)).rejects.toThrow();
    await expect(setContactActive(reader, contact.id, false)).rejects.toThrow();
    const document = await db.query(`INSERT INTO sales_document
      (id, company_id, kind, contact_id, issue_date, posting_date, due_date, tax_rounding, created_by_id, updated_at)
      VALUES (gen_random_uuid(), $1, 'INVOICE', $2, '2026-04-01', '2026-04-01', '2026-05-01', 'PER_LINE', $3, now()) RETURNING id`, [W.companyA, contact.id, W.userOwnerA]);
    await setContactActive(actor, contact.id, false);
    expect((await db.query("SELECT contact_id FROM sales_document WHERE id = $1", [document.rows[0].id])).rows[0].contact_id).toBe(contact.id);
    expect((await listContacts(actor, { q: "Boréal" })).total).toBe(0);
    expect((await listContacts(actor, { q: "Boréal", status: "ARCHIVED" })).contacts[0]?.id).toBe(contact.id);
    await setContactActive(actor, contact.id, true);
    expect(await getContact(actor, contact.id)).toMatchObject({ isActive: true });
    const audit = await db.query("SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at, id", [contact.id]);
    expect(audit.rows.map((row) => row.action)).toEqual(["row.insert", "row.update", "row.update"]);
  });

  it("isolates tenants and ignores mass assignment", async () => {
    const contact = await saveContact(actor, { ...input, displayName: "Tenant boundary", companyId: W.companyB, isActive: false });
    expect(contact.isActive).toBe(true);
    expect(await getContact(other, contact.id)).toBeNull();
    expect((await listContacts(other, { q: "Tenant boundary" })).total).toBe(0);
    await expect(saveContact(other, input, contact.id)).rejects.toThrow();
    await expect(setContactActive(other, contact.id, false)).rejects.toThrow();
    expect((await getContact(actor, contact.id))?.displayName).toBe("Tenant boundary");
  });

  it("never exposes or repopulates an anonymized contact", async () => {
    const contact = await saveContact(actor, { ...input, displayName: "Privacy fixture" });
    await db.query("UPDATE contact SET anonymized_at = now(), is_active = false WHERE id = $1", [contact.id]);
    expect(await getContact(actor, contact.id)).toBeNull();
    expect((await listContacts(actor, { q: "Privacy fixture", status: "ALL" })).total).toBe(0);
    await expect(saveContact(actor, input, contact.id)).rejects.toThrow();
    await expect(setContactActive(actor, contact.id, true)).rejects.toThrow();
  });

  it("searches literal wildcards and filters customers/suppliers", async () => {
    await saveContact(actor, { kind: "SUPPLIER", displayName: "Literal 50%_supplier" });
    await saveContact(actor, { kind: "CUSTOMER", displayName: "Literal 50XYcustomer" });
    expect((await listContacts(actor, { q: "50%_" })).total).toBe(1);
    expect((await listContacts(actor, { q: "Literal", kind: "CUSTOMER" })).total).toBe(1);
    expect((await listContacts(actor, { q: "Literal", kind: "SUPPLIER" })).total).toBe(1);
  });

  it("paginates deterministically and clamps a stale page", async () => {
    for (let i = 0; i < 26; i++) await saveContact(actor, { kind: "CUSTOMER", displayName: `Paging ${String(i).padStart(2, "0")}` });
    const first = await listContacts(actor, { q: "Paging" });
    const last = await listContacts(actor, { q: "Paging", page: 99 });
    expect(first.contacts).toHaveLength(25);
    expect(last).toMatchObject({ total: 26, page: 2, pageCount: 2 });
    expect(last.contacts.map((c) => c.displayName)).toEqual(["Paging 25"]);
  });
});
