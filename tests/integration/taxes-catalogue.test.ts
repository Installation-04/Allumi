import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { archiveCatalog, createTax, createTaxCode, getItem, getTaxConfiguration, listItems, saveItem, scheduleRate, calculateTaxes } from "@/modules/taxes";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const accountant = { ...actor, userId: W.userAccountant };
const other = { userId: W.userOwnerB, companyId: W.companyB };
const item = { code: "CONS", name: "Consultation", description: "", unitPrice: "125.123456", incomeAccountId: W.sales, expenseAccountId: W.expenses, defaultTaxCodeId: W.taxCodeStandard };
const tax = { code: "CUSTOM", nameFr: "Taxe", nameEn: "Tax", percent: "5", from: "2026-01-01", payableAccountId: W.gstPayable, recoverableAccountId: W.gstReceivable };
let db: pg.Client;
beforeAll(async () => { db = await owner(); await seedWorld(db); });
afterAll(async () => { await db?.end(); });
it("preserves exact prices, enforces roles and tenants, and audits archive/restore", async () => {
  const id = await saveItem(accountant, { ...item, companyId: W.companyB, isActive: false });
  expect(await getItem(reader, id)).toMatchObject({ unitPrice: "125.123456", companyId: W.companyA, isActive: true });
  await expect(saveItem(reader, item)).rejects.toThrow();
  await expect(archiveCatalog(reader, "item", id, false)).rejects.toThrow();
  expect(await getItem(other, id)).toBeNull();
  expect((await listItems(other, "Consultation")).items).toHaveLength(0);
  await expect(saveItem(other, item, id)).rejects.toThrow();
  await expect(archiveCatalog(other, "item", id, false)).rejects.toThrow();
  await saveItem(actor, { ...item, unitPrice: "150,123456" }, id);
  expect((await getItem(reader, id))?.unitPrice).toBe("150.123456");
  await archiveCatalog(actor, "item", id, false);
  expect((await listItems(actor, "Consultation")).items).toHaveLength(0);
  expect((await listItems(actor, "Consultation", true)).items).toHaveLength(1);
  await archiveCatalog(actor, "item", id, true);
  expect((await db.query("SELECT action FROM audit_log WHERE entity_id=$1 ORDER BY occurred_at,id", [id])).rows.map(r => r.action)).toEqual(["row.insert", "row.update", "row.update", "row.update"]);
  await expect(saveItem(actor, item)).rejects.toThrow();
  await expect(saveItem(actor, { ...item, code: "BAD", incomeAccountId: W.bankB })).rejects.toThrow();
  await expect(saveItem(actor, { ...item, code: "BAD", unitPrice: "-1" })).rejects.toThrow();
  await expect(db.query("UPDATE item SET unit_price=-1 WHERE id=$1", [id])).rejects.toMatchObject({ code: "23514" });
  await expect(db.query("UPDATE item SET income_account_id=$1 WHERE id=$2", [W.expenses, id])).rejects.toThrow();
});
it("creates dated taxes and codes without allowing readers or foreign references", async () => {
  await expect(createTax(reader, tax)).rejects.toThrow();
  await expect(createTax(actor, { ...tax, payableAccountId: W.gstReceivable })).rejects.toThrow();
  const id = await createTax(accountant, tax);
  await expect(db.query("UPDATE tax SET payable_account_id=$1, recoverable_account_id=NULL WHERE id=$2", [W.gstReceivable, id])).rejects.toThrow();
  await expect(createTaxCode(other, { code: "FOREIGN", nameFr: "X", nameEn: "X", treatment: "STANDARD", taxIds: [id] })).rejects.toThrow();
  const code = await createTaxCode(actor, { code: "CUSTOM", nameFr: "X", nameEn: "X", treatment: "STANDARD", taxIds: [id] });
  await expect(createTaxCode(actor, { code: "BAD", nameFr: "X", nameEn: "X", treatment: "EXEMPT", taxIds: [id] })).rejects.toThrow();
  await archiveCatalog(actor, "taxCode", code, false);
  await expect(saveItem(actor, { ...item, code: "ARCH", defaultTaxCodeId: code })).rejects.toThrow();
  await expect(scheduleRate(reader, { taxId: id, from: "2990-01-01", percent: "6" })).rejects.toThrow();
  await expect(scheduleRate(actor, { taxId: id, from: "2020-01-01", percent: "6" })).rejects.toThrow();
  const results = await Promise.allSettled([1, 2].map(() => scheduleRate(actor, { taxId: id, from: "2990-01-01", percent: "6" })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const config = await getTaxConfiguration(reader);
  expect(config.taxes.find(t => t.id === id)?.rates).toMatchObject([{ rate: "0.05", from: "2026-01-01", to: "2989-12-31" }, { rate: "0.06", from: "2990-01-01", to: null }]);
});
it("agrees with PostgreSQL exact rounding for line and document taxes", async () => {
  for (const rounding of ["PER_LINE", "PER_DOCUMENT"] as const) {
    for (const price of ["0.05", "125.123456", "-0.05"]) {
      const lines = [1, 2].map(() => ({ quantity: "1", unitPrice: price, taxes: [{ id: "GST", rate: "0.05" }] }));
      const actual = calculateTaxes(lines, rounding);
      const sql = await db.query(`SELECT round($1::numeric*100)*2 AS subtotal, CASE WHEN $2='PER_LINE' THEN round(round($1::numeric*100)*0.05)*2 ELSE round(round($1::numeric*100)*2*0.05) END AS tax`, [price, rounding]);
      expect(actual.subtotalCents).toBe(BigInt(sql.rows[0].subtotal));
      expect(actual.taxCents).toBe(BigInt(sql.rows[0].tax));
    }
  }
});
