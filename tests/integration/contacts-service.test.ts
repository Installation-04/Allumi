import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonymizeContact, createContact, createItem, deleteContact, deleteItem, getContact, getItem, listContacts, listItems, setContactActive, setItemActive, updateContact, updateItem } from "@/modules/contacts";
import { initializeLedger, listAccounts, type Actor } from "@/modules/ledger";
import { listAuditLog } from "@/modules/audit";
import { installQuebecTaxes, listTaxCodes } from "@/modules/taxes";
import { AppError } from "@/platform/errors";
import { owner, seedCompany, seedUser } from "./helpers";

let db: pg.Client;
beforeAll(async () => {
  db = await owner();
});
afterAll(async () => {
  await db.end();
});

type World = { companyId: string; actor: Actor; accountant: Actor; reader: Actor };

async function newWorld(label: string): Promise<World> {
  const tag = randomUUID().slice(0, 8);
  const [ownerId, accountantId, readerId] = [
    await seedUser(db, { email: `proprio-${label}-${tag}@exemple.test` }),
    await seedUser(db, { email: `comptable-${label}-${tag}@exemple.test` }),
    await seedUser(db, { email: `lecture-${label}-${tag}@exemple.test` }),
  ];
  const companyId = await seedCompany(db, `Atelier contacts ${label} ${tag}`, [
    { userId: ownerId, role: "OWNER" },
    { userId: accountantId, role: "ACCOUNTANT" },
    { userId: readerId, role: "READ_ONLY" },
  ]);
  const actor = { userId: ownerId, companyId };
  await initializeLedger(actor);
  return { companyId, actor, accountant: { userId: accountantId, companyId }, reader: { userId: readerId, companyId } };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.key;
    throw error;
  }
  throw new Error("expected a refusal");
}

const customer = (displayName: string, extra: Record<string, unknown> = {}) => ({ isCustomer: true, isSupplier: false, displayName, ...extra });

describe("contacts", () => {
  it("creates a customer and a supplier, normalizes the numbers and the postal code, and reads them back", async () => {
    const w = await newWorld("create");
    const supplier = await createContact(w.actor, {
      isCustomer: false,
      isSupplier: true,
      displayName: "Papeterie Lévesque",
      legalName: "Papeterie Lévesque inc.",
      email: "compta@papeterie.exemple.test",
      city: "Québec",
      province: "QC",
      postalCode: "g1a 0a2",
      gstNumber: "123 456 789 RT 0001",
      qstNumber: "1234567890 tq 0001",
      paymentTermsDays: "45" as unknown as number,
    });
    expect(supplier).toMatchObject({ isCustomer: false, isSupplier: true, postalCode: "G1A 0A2", gstNumber: "123456789RT0001", qstNumber: "1234567890TQ0001", paymentTermsDays: 45, country: "CA", locale: "fr_CA", isActive: true, anonymized: false });
    expect(await getContact(w.actor, supplier.id)).toEqual(supplier);
    const client = await createContact(w.actor, customer("Boulangerie Dupuis", { locale: "en", province: "" }));
    expect(client).toMatchObject({ locale: "en", province: null, paymentTermsDays: 30 });
  });

  it("refuses what the form should not let through, with the box that is wrong", async () => {
    const w = await newWorld("refusals");
    expect(await refusal(createContact(w.actor, { isCustomer: false, isSupplier: false, displayName: "Personne" }))).toBe("contacts.invalid.isCustomer");
    expect(await refusal(createContact(w.actor, customer("   ")))).toBe("contacts.invalid.displayName");
    expect(await refusal(createContact(w.actor, customer("X", { email: "pas un courriel" })))).toBe("contacts.invalid.email");
    expect(await refusal(createContact(w.actor, customer("X", { postalCode: "D2X 1Y4" })))).toBe("contacts.invalid.postalCode");
    expect(await refusal(createContact(w.actor, customer("X", { gstNumber: "123" })))).toBe("contacts.invalid.gstNumber");
    expect(await refusal(createContact(w.actor, customer("X", { qstNumber: "123456789RT0001" })))).toBe("contacts.invalid.qstNumber");
    expect(await refusal(createContact(w.actor, customer("X", { paymentTermsDays: 400 })))).toBe("contacts.invalid.paymentTermsDays");
    // a foreign postal code is not checked against the Canadian format
    expect((await createContact(w.actor, customer("Acme US", { country: "us", postalCode: "90210" }))).postalCode).toBe("90210");
    expect(await refusal(createContact(w.actor, customer("X", { defaultTaxCodeId: randomUUID() })))).toBe("contacts.taxCodeNotFound");
  });

  it("lets owners and accountants write, everybody read, nobody else see", async () => {
    const [w, other] = [await newWorld("roles"), await newWorld("roles-other")];
    await createContact(w.accountant, customer("Écrit par la comptable"));
    expect(await refusal(createContact(w.reader, customer("Refusé")))).toBe("forbidden");
    expect((await listContacts(w.reader)).total).toBe(1);
    // another company's contact does not exist here, even by id
    const foreign = await createContact(other.actor, customer("Chez l'autre"));
    expect(await getContact(w.actor, foreign.id)).toBeNull();
    expect(await refusal(updateContact(w.actor, foreign.id, customer("Piraté")))).toBe("contacts.notFound");
    expect(await refusal(deleteContact(w.actor, foreign.id))).toBe("contacts.notFound");
    // a non-member is refused
    expect(await refusal(listContacts({ userId: other.actor.userId, companyId: w.companyId }))).toBe("forbidden");
  });

  it("searches, filters by role, hides the inactive ones and pages", async () => {
    const w = await newWorld("list");
    for (let i = 1; i <= 27; i++) await createContact(w.actor, customer(`Client ${String(i).padStart(2, "0")}`));
    await createContact(w.actor, { isCustomer: false, isSupplier: true, displayName: "Fournisseur Unique", email: "unique@exemple.test" });
    const first = await listContacts(w.actor);
    expect(first).toMatchObject({ total: 28, page: 1, pageCount: 2 });
    expect(first.contacts).toHaveLength(25);
    expect((await listContacts(w.actor, { page: 2 })).contacts).toHaveLength(3);
    expect((await listContacts(w.actor, { page: 99 })).page).toBe(2);
    expect((await listContacts(w.actor, { page: Number.NaN })).page).toBe(1);
    expect((await listContacts(w.actor, { filter: "suppliers" })).contacts.map((c) => c.displayName)).toEqual(["Fournisseur Unique"]);
    expect((await listContacts(w.actor, { filter: "customers" })).total).toBe(27);
    expect((await listContacts(w.actor, { search: "UNIQUE" })).total).toBe(1);
    expect((await listContacts(w.actor, { search: "%" })).total).toBe(0); // a wildcard is text, not a pattern
    const target = (await listContacts(w.actor, { search: "Client 01" })).contacts[0];
    await setContactActive(w.actor, target?.id ?? "", false);
    expect((await listContacts(w.actor)).total).toBe(27);
    expect((await listContacts(w.actor, { includeInactive: true })).total).toBe(28);
  });

  it("updates a contact, deletes one that nothing refers to, and keeps one that a document refers to", async () => {
    const w = await newWorld("update");
    const contact = await createContact(w.actor, customer("Avant"));
    const updated = await updateContact(w.actor, contact.id, customer("Après", { email: "apres@exemple.test" }));
    expect(updated).toMatchObject({ displayName: "Après", email: "apres@exemple.test" });
    await deleteContact(w.actor, contact.id);
    expect(await getContact(w.actor, contact.id)).toBeNull();

    // a contact that a sales document refers to cannot be deleted (it is deactivated instead)
    const used = await createContact(w.actor, customer("Client facturé"));
    await db.query("ALTER TABLE sales_document DISABLE TRIGGER USER"); // a bare row is enough to hold the reference
    const author = w.actor.userId;
    await db.query(
      "INSERT INTO sales_document (id, company_id, kind, status, contact_id, issue_date, posting_date, tax_rounding, created_by_id, updated_at) VALUES ($1, $2, 'INVOICE', 'DRAFT', $3, '2026-05-01', '2026-05-01', 'PER_LINE', $4, now())",
      [randomUUID(), w.companyId, used.id, author],
    );
    await db.query("ALTER TABLE sales_document ENABLE TRIGGER USER");
    expect(await refusal(deleteContact(w.actor, used.id))).toBe("contacts.inUse");
  });
});

describe("anonymizing a contact (Law 25)", () => {
  it("erases the personal data, keeps the record, and redacts the audit trail of that contact", async () => {
    const w = await newWorld("anonymize");
    const contact = await createContact(w.actor, customer("Marie Tremblay", { legalName: "Marie Tremblay", email: "marie@exemple.test", phone: "514 555-0100", addressLine1: "12 rue Principale", city: "Laval", postalCode: "H7N 1A1", notes: "Préfère le matin", gstNumber: "123456789RT0001" }));
    expect(await refusal(anonymizeContact(w.accountant, contact.id))).toBe("forbidden");
    await anonymizeContact(w.actor, contact.id, { now: new Date("2026-07-01T12:00:00Z") });

    const after = await getContact(w.actor, contact.id);
    expect(after).toMatchObject({ anonymized: true, isActive: false, legalName: null, email: null, phone: null, addressLine1: null, city: null, postalCode: null, notes: null, gstNumber: null });
    expect(after?.displayName).toMatch(/^Anonymisé /);
    expect(after?.displayName).not.toContain("Marie");

    // nothing of the person is left in the audit trail of the contact, but the facts are (who, what, when)
    const trail = await listAuditLog(w.actor, { entityType: "contact", entityId: contact.id });
    expect(trail.entries.length).toBeGreaterThanOrEqual(3); // insert, update, redaction event
    const everything = JSON.stringify(trail.entries.map((entry) => [entry.before, entry.after]));
    for (const secret of ["Marie", "marie@exemple.test", "514 555-0100", "12 rue Principale", "Laval", "H7N 1A1", "Préfère le matin"]) expect(everything).not.toContain(secret);
    expect(trail.entries.map((entry) => entry.action)).toContain("privacy.redact");

    // an anonymized contact is not edited or brought back, and doing it twice is harmless
    expect(await refusal(updateContact(w.actor, contact.id, customer("Retour")))).toBe("contacts.anonymized");
    expect(await refusal(setContactActive(w.actor, contact.id, true))).toBe("contacts.anonymized");
    await anonymizeContact(w.actor, contact.id);
  });
});

describe("items", () => {
  it("creates an item with a price, accounts and a tax code, and reads the price back exactly", async () => {
    const w = await newWorld("items");
    await installQuebecTaxes(w.actor);
    const accounts = await listAccounts(w.actor);
    const revenue = accounts.find((account) => account.code === "4000");
    const expense = accounts.find((account) => account.code === "6040");
    const code = (await listTaxCodes(w.actor)).find((c) => c.code === "TPS-TVQ");
    const item = await createItem(w.actor, { code: "CONS-1", name: "Consultation (heure)", unitPrice: 85_500_000n, incomeAccountId: revenue?.id, expenseAccountId: expense?.id, defaultTaxCodeId: code?.id });
    expect(item).toMatchObject({ code: "CONS-1", unitPrice: 85_500_000n, incomeAccountId: revenue?.id, defaultTaxCodeId: code?.id, isActive: true });
    const odd = await createItem(w.actor, { name: "Prix à six décimales", unitPrice: 1_234_567n });
    expect((await getItem(w.actor, odd.id))?.unitPrice).toBe(1_234_567n);
    expect((await createItem(w.actor, { name: "Sans prix" })).unitPrice).toBeNull();
    expect((await createItem(w.actor, { name: "Rabais", unitPrice: -5_000_000n })).unitPrice).toBe(-5_000_000n);
  });

  it("refuses the wrong kind of account, a missing tax code, a duplicate code and a reader", async () => {
    const w = await newWorld("items-refusals");
    const accounts = await listAccounts(w.actor);
    const bank = accounts.find((account) => account.code === "1000");
    const revenue = accounts.find((account) => account.code === "4000");
    const expense = accounts.find((account) => account.code === "6040");
    expect(await refusal(createItem(w.actor, { name: "X", incomeAccountId: bank?.id }))).toBe("items.accountInvalid");
    expect(await refusal(createItem(w.actor, { name: "X", incomeAccountId: expense?.id }))).toBe("items.accountInvalid");
    expect(await refusal(createItem(w.actor, { name: "X", expenseAccountId: revenue?.id }))).toBe("items.accountInvalid");
    expect(await refusal(createItem(w.actor, { name: "X", defaultTaxCodeId: randomUUID() }))).toBe("items.taxCodeNotFound");
    expect(await refusal(createItem(w.actor, { name: "   " }))).toBe("items.invalid");
    await createItem(w.actor, { code: "A1", name: "Premier" });
    expect(await refusal(createItem(w.actor, { code: "A1", name: "Second" }))).toBe("items.codeTaken");
    expect(await refusal(createItem(w.reader, { name: "Refusé" }))).toBe("forbidden");
    expect((await listItems(w.reader)).total).toBe(1);
  });

  it("updates, deactivates, searches and deletes an item that no document line uses", async () => {
    const w = await newWorld("items-life");
    const item = await createItem(w.actor, { code: "Z9", name: "Ancien nom" });
    expect(await updateItem(w.actor, item.id, { code: "Z9", name: "Nouveau nom", unitPrice: 10_000_000n })).toMatchObject({ name: "Nouveau nom", unitPrice: 10_000_000n });
    expect(await refusal(updateItem(w.actor, randomUUID(), { name: "Fantôme" }))).toBe("items.notFound");
    expect((await listItems(w.actor, { search: "z9" })).total).toBe(1);
    await setItemActive(w.actor, item.id, false);
    expect((await listItems(w.actor)).total).toBe(0);
    expect((await listItems(w.actor, { includeInactive: true })).total).toBe(1);
    await deleteItem(w.actor, item.id);
    expect(await getItem(w.actor, item.id)).toBeNull();
  });

  it("does not see another company's items", async () => {
    const [a, b] = [await newWorld("items-a"), await newWorld("items-b")];
    const item = await createItem(a.actor, { name: "Chez A" });
    expect(await getItem(b.actor, item.id)).toBeNull();
    expect(await refusal(setItemActive(b.actor, item.id, false))).toBe("items.notFound");
    expect(await refusal(deleteItem(b.actor, item.id))).toBe("items.notFound");
  });
});
