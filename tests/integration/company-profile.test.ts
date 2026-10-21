import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { getCompanyProfile, updateCompanyProfile } from "@/modules/companies";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const accountant = { ...actor, userId: W.userAccountant };
const outsider = { ...actor, userId: W.userOwnerB };
const input = { name: "Atelier Exemple", legalName: "Atelier Exemple inc.", province: "QC", defaultLocale: "en", taxRounding: "PER_DOCUMENT", taxFilingFrequency: "ANNUAL", gstNumber: "123 456 789 rt 0001", qstNumber: "1234567890 tq 0001", postalCode: "h2x1y4", email: "billing@example.test", addressLine1: "123 rue Exemple" };
let db: pg.Client;
beforeAll(async () => { db = await owner(); await seedWorld(db); });
afterAll(async () => { await db?.end(); });
it("updates identity exactly, audits changes and strips protected fields", async () => {
  const before = await getCompanyProfile(actor);
  const updated = await updateCompanyProfile(actor, { ...input, id: W.companyB, companyId: W.companyB, fiscalYearStartMonth: 7, currency: "USD" });
  expect(updated).toMatchObject({ id: W.companyA, gstNumber: "123456789RT0001", qstNumber: "1234567890TQ0001", postalCode: "H2X 1Y4", fiscalYearStartMonth: before.fiscalYearStartMonth, taxRounding: "PER_DOCUMENT" });
  expect((await db.query("SELECT currency FROM company WHERE id=$1", [W.companyA])).rows[0].currency).toBe("CAD");
  expect((await getCompanyProfile(reader)).email).toBe(input.email);
  expect((await getCompanyProfile(accountant)).addressLine1).toBe(input.addressLine1);
  const audit = await db.query("SELECT action FROM audit_log WHERE entity_id=$1 AND action='row.update'", [W.companyA]);
  expect(audit.rows.length).toBeGreaterThan(0);
});
it("refuses non-owner writes and foreign-company access without changes", async () => {
  for (const user of [reader, accountant, outsider]) await expect(updateCompanyProfile(user, input)).rejects.toThrow();
  await expect(getCompanyProfile(outsider)).rejects.toThrow();
  expect((await getCompanyProfile(actor)).name).toBe(input.name);
});
it("rejects invalid registrations atomically and allows explicit removal", async () => {
  for (const field of ["gstNumber", "qstNumber", "businessNumber", "neq", "postalCode", "email"]) {
    await expect(updateCompanyProfile(actor, { ...input, name: "Must not persist", [field]: "invalid" })).rejects.toThrow();
  }
  expect((await getCompanyProfile(actor)).name).toBe(input.name);
  const cleared = await updateCompanyProfile(actor, { ...input, gstNumber: "", qstNumber: "", postalCode: "" });
  expect(cleared).toMatchObject({ gstNumber: null, qstNumber: null, postalCode: null });
});
