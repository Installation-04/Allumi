import { expect, it } from "vitest";
import { compareOfficialCode, type ComparableCode, type OfficialPreview } from "@/modules/taxes";
const part = (code: string, rate: string) => ({ code, nameFr: code, nameEn: code, isActive: true, rates: [{ rate, from: "2013-01-01", to: null }] });
const code: ComparableCode = { code: "QC-STD", nameFr: "Taxes", nameEn: "Taxes", isActive: true, treatment: "STANDARD", components: [part("TVQ", "0.099750"), part("TPS", "0.05")] };
const preview: OfficialPreview = { province: "QC", date: "2026-01-01", fingerprint: "a".repeat(64), sources: [{ id: "CRA_GST_HST", url: "https://example.test", sha256: "a".repeat(64), collectedAt: "2026-01-01T00:00:00Z", rates: [{ from: "2013-01-01", to: null, rate: "0.050000", percent: "5" }] }, { id: "RQ_QST", url: "https://example.test", sha256: "b".repeat(64), collectedAt: "2026-01-01T00:00:00Z", rates: [{ from: "2013-01-01", to: null, rate: "0.099750", percent: "9.975" }] }] };
it("compares exact component rates independently of order, names and decimal padding", () => {
  expect(compareOfficialCode(code, preview).status).toBe("MATCH");
  const reordered = structuredClone(code); reordered.components.reverse(); reordered.components[0]!.nameFr = "Arbitrary name";
  expect(compareOfficialCode(reordered, preview).status).toBe("MATCH");
});
it("rejects equal totals with different components and preserves duplicate rate multiplicities", () => {
  expect(compareOfficialCode({ ...code, components: [part("A", "0.07"), part("B", "0.07975")] }, preview).status).toBe("DIFFERENT");
  expect(compareOfficialCode({ ...code, components: [part("A", "0.14975")] }, preview).status).toBe("DIFFERENT");
  expect(compareOfficialCode({ ...code, components: [...code.components, part("C", "0.05")] }, preview).status).toBe("DIFFERENT");
  expect(compareOfficialCode({ ...code, components: [part("A", "0.05"), part("B", "0.099751")] }, preview).status).toBe("DIFFERENT");
});
it("does not substitute zero for missing or ambiguous dated rates", () => {
  const missing = structuredClone(code); missing.components[0]!.rates[0]!.from = "2026-01-02";
  expect(compareOfficialCode(missing, preview).status).toBe("MISSING_RATE");
  expect(compareOfficialCode(missing, preview).components[0]!.rate).toBeNull();
  missing.components[0]!.rates = [part("A", "0.05").rates[0]!, part("A", "0.09975").rates[0]!];
  expect(compareOfficialCode(missing, preview).status).toBe("MISSING_RATE");
});
it("distinguishes current inactivity and nonstandard treatments from a matching rate", () => {
  expect(compareOfficialCode({ ...code, isActive: false }, preview).status).toBe("INACTIVE");
  expect(compareOfficialCode({ ...code, components: code.components.map(p => ({ ...p, isActive: false })) }, preview).status).toBe("INACTIVE");
  for (const treatment of ["ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]) expect(compareOfficialCode({ ...code, treatment, components: [] }, preview).status).toBe("NON_STANDARD");
});
