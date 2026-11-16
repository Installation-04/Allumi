import "server-only";
import { requireRole } from "@/modules/companies";
import { todayIso } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { officialScope } from "../domain/official-sources";
import { compareOfficialCode, type ComparableCode } from "../domain/official-comparison";
import { fetchOfficialPreview } from "../connectors/official";

/** One SQL snapshot of the local code, components and dated rates, without accounting references. */
async function readCode(actor: CompanyContext, code: string): Promise<ComparableCode> {
  return withCompany(actor, async tx => {
    await requireRole(tx, "taxes.read");
    const rows = await tx.$queryRaw<ComparableCode[]>`
      SELECT c.code,c.name_fr AS "nameFr",c.name_en AS "nameEn",c.is_active AS "isActive",c.treatment::text,
        coalesce((SELECT jsonb_agg(jsonb_build_object('code',t.code,'nameFr',t.name_fr,'nameEn',t.name_en,'isActive',t.is_active,
          'rates',coalesce((SELECT jsonb_agg(jsonb_build_object('rate',r.rate::text,'from',r.effective_from::text,'to',r.effective_to::text) ORDER BY r.effective_from)
            FROM tax_rate r WHERE r.company_id=c.company_id AND r.tax_id=t.id),'[]'::jsonb)) ORDER BY p.position)
          FROM tax_code_component p JOIN tax t ON t.company_id=p.company_id AND t.id=p.tax_id
          WHERE p.company_id=c.company_id AND p.tax_code_id=c.id),'[]'::jsonb) AS components
      FROM tax_code c WHERE c.company_id=${actor.companyId}::uuid AND c.code=${code}`;
    if (!rows[0]) throw new AppError("catalog.notFound");
    return rows[0];
  });
}

/** Network access is authorized first; local configuration and rights are reread after the fetch. */
export async function getOfficialCodeComparison(actor: CompanyContext, province: string, date: string, code: string) {
  let scope;
  try { scope = officialScope(province, date, todayIso()); } catch { throw new AppError("officialTaxes.invalid"); }
  if (!/^[A-Z0-9][A-Z0-9+-]{0,23}$/.test(code)) throw new AppError("officialTaxes.invalid");
  await readCode(actor, code);
  const preview = await fetchOfficialPreview(scope.province, scope.date);
  const local = await readCode(actor, code);
  return { preview, comparison: compareOfficialCode(local, preview) };
}
