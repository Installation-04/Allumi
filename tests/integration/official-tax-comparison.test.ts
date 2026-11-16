import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type pg from "pg";
import { getOfficialCodeComparison, getOfficialTaxPreview, importOfficialTaxes, createTaxCode, createTax, archiveCatalog, CRA_URL } from "@/modules/taxes";
import cra from "../fixtures/official-tax-cra.json";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA }, reader = { ...actor, userId: W.userReader };
const rq = readFileSync(new URL("../fixtures/official-tax-rq.html", import.meta.url), "utf8");
const fetch = vi.fn(async (url: unknown) => new Response(url === CRA_URL ? JSON.stringify(cra) : rq, { headers: { "content-type": url === CRA_URL ? "application/json" : "text/html" } }));
let db: pg.Client;
beforeAll(async () => {
  db = await owner(); await seedWorld(db); vi.stubGlobal("fetch", fetch);
  for (const province of ["QC", "NS"]) {
    const preview = await getOfficialTaxPreview(actor, province, "2026-01-01");
    await importOfficialTaxes(actor, { province, date: "2026-01-01", code: province + "-EXT", fingerprint: preview.fingerprint, federalPayable: W.gstPayable, federalRecoverable: W.gstReceivable, qstPayable: W.qstPayable, qstRecoverable: W.qstReceivable, confirmed: "yes" });
  }
});
afterAll(async () => { vi.unstubAllGlobals(); await db?.end(); });
it("compares imported Quebec and dated HST codes exactly without any database writes or private references", async () => {
  const before = (await db.query("SELECT (SELECT count(*) FROM audit_log)::text AS audit,(SELECT count(*) FROM tax_rate)::text AS rates")).rows[0];
  const qc = await getOfficialCodeComparison(reader, "QC", "2026-01-01", "QC-EXT"); expect(qc.comparison.status).toBe("MATCH"); expect(qc.comparison.expected.map(x => x.rate)).toEqual(["0.050000", "0.099750"]);
  for (const date of ["2025-03-31", "2025-04-01"]) { const ns = await getOfficialCodeComparison(reader, "NS", date, "NS-EXT"); expect(ns.comparison.status).toBe("MATCH"); expect(ns.comparison.components[0]!.rate).toBe(date.endsWith("03-31") ? "0.150000" : "0.140000"); }
  expect((await getOfficialCodeComparison(reader, "ON", "2026-01-01", "QC-EXT")).comparison.status).toBe("DIFFERENT");
  const text = JSON.stringify(qc); for (const value of [W.gstPayable, W.gstReceivable, W.userOwnerA, "payableAccount", "recoverableAccount", "audit", "contact"]) expect(text).not.toContain(value);
  expect((await db.query("SELECT (SELECT count(*) FROM audit_log)::text AS audit,(SELECT count(*) FROM tax_rate)::text AS rates")).rows[0]).toEqual(before);
});
it("supports manual codes without inferring providers from their names and reports inactive, missing and nonstandard definitions", async () => {
  const id = await createTaxCode(actor, { code: "MANUAL-CMP", nameFr: "Manuel", nameEn: "Manual", treatment: "STANDARD", taxIds: [W.qst, W.gst] });
  expect((await getOfficialCodeComparison(reader, "QC", "2026-01-01", "MANUAL-CMP")).comparison.status).toBe("MATCH");
  const futureTax = await createTax(actor, { code: "GAP", nameFr: "Couverture datée", nameEn: "Dated coverage", payableAccountId: W.gstPayable, recoverableAccountId: "", percent: "5", from: "2026-01-01" });
  await createTaxCode(actor, { code: "GAP-CMP", nameFr: "Période manquante", nameEn: "Missing period", treatment: "STANDARD", taxIds: [futureTax] });
  expect((await getOfficialCodeComparison(reader, "QC", "2013-04-01", "GAP-CMP")).comparison.status).toBe("MISSING_RATE");
  await archiveCatalog(actor, "taxCode", id, false); expect((await getOfficialCodeComparison(reader, "QC", "2026-01-01", "MANUAL-CMP")).comparison.status).toBe("INACTIVE");
  await createTaxCode(actor, { code: "EXEMPT-CMP", nameFr: "Exonéré", nameEn: "Exempt", treatment: "EXEMPT", taxIds: [] });
  expect((await getOfficialCodeComparison(reader, "QC", "2026-01-01", "EXEMPT-CMP")).comparison.status).toBe("NON_STANDARD");
});
it("reports source changes and inactive components without updating local rates, and fails closed on outages", async () => {
  const changed = structuredClone(cra); changed.result.records.find(row => row.JRSD_CD === "NS")!.VPR1_HST = "13 %";
  fetch.mockImplementationOnce(async () => new Response(JSON.stringify(changed), { headers: { "content-type": "application/json" } }));
  const result = await getOfficialCodeComparison(reader, "NS", "2026-01-01", "NS-EXT"); expect(result.comparison.status).toBe("DIFFERENT"); expect(result.comparison.expected[0]!.rate).toBe("0.130000"); expect(result.comparison.components[0]!.rate).toBe("0.140000");
  await db.query("UPDATE tax SET is_active=false WHERE company_id=$1 AND code='NS-EXT-FED'", [W.companyA]);
  try { expect((await getOfficialCodeComparison(reader, "NS", "2026-01-01", "NS-EXT")).comparison.status).toBe("INACTIVE"); } finally { await db.query("UPDATE tax SET is_active=true WHERE company_id=$1 AND code='NS-EXT-FED'", [W.companyA]); }
  fetch.mockImplementationOnce(async () => new Response("Unavailable", { status: 503 }));
  await expect(getOfficialCodeComparison(reader, "NS", "2026-01-01", "NS-EXT")).rejects.toMatchObject({ key: "officialTaxes.unavailable" });
});
it("requires only tax read access, rejects forbidden/missing codes before external requests and rechecks after fetch", async () => {
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader, JSON.stringify({ taxes: "read", accounting: "none", audit: "none", sales: "none", contacts: "none" })]);
  expect((await getOfficialCodeComparison(reader, "QC", "2026-01-01", "QC-EXT")).comparison.status).toBe("MATCH");
  for (const [a, code] of [[{ ...reader, companyId: W.companyB }, "QC-EXT"], [{ userId: W.userOwnerB, companyId: W.companyB }, "QC-EXT"], [reader, "NO-SUCH-CODE"]] as const) { fetch.mockClear(); await expect(getOfficialCodeComparison(a, "QC", "2026-01-01", code)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled(); }
  fetch.mockClear(); await expect(getOfficialCodeComparison(reader, "XX", "2026-02-30", "QC-EXT")).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  fetch.mockImplementationOnce(async () => { await db.query("UPDATE membership SET module_access='{\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader]); return new Response(JSON.stringify(cra), { headers: { "content-type": "application/json" } }); });
  await expect(getOfficialCodeComparison(reader, "NS", "2026-01-01", "NS-EXT")).rejects.toThrow();
  fetch.mockClear(); await expect(getOfficialCodeComparison(reader, "QC", "2026-01-01", "QC-EXT")).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
