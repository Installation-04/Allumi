import "server-only";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext as Actor } from "@/platform/tenant";
import { companyProfileSchema, type CompanyProfile } from "../domain/profile";
import { requireRole } from "./access";

/** The company's identity and tax settings. Every member may read them (they are printed on documents). */
export async function getCompanyProfile(actor: Actor): Promise<CompanyProfile> {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "company.read");
    const row = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId } });
    return {
      id: row.id,
      name: row.name,
      legalName: row.legalName,
      neq: row.neq,
      businessNumber: row.businessNumber,
      gstNumber: row.gstNumber,
      qstNumber: row.qstNumber,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      province: row.province,
      postalCode: row.postalCode,
      email: row.email,
      phone: row.phone,
      defaultLocale: row.defaultLocale,
      taxRounding: row.taxRounding,
      taxFilingFrequency: row.taxFilingFrequency,
      fiscalYearStartMonth: row.fiscalYearStartMonth,
    };
  });
}

/**
 * Updates the company's profile (owner only). The tax rounding rule is copied on each document when it is created:
 * changing it does not touch documents already written. The first month of the fiscal year is not here: the fiscal years
 * already exist.
 */
export async function updateCompanyProfile(actor: Actor, input: unknown): Promise<CompanyProfile> {
  const parsed = companyProfileSchema.safeParse(input);
  if (!parsed.success) {
    // Say which box is wrong when it is one the person types (a number, a postal code, an email).
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    throw new AppError(["name", "gstNumber", "qstNumber", "neq", "businessNumber", "postalCode", "email"].includes(field) ? `company.invalid.${field}` : "company.invalidProfile");
  }
  await withCompany(actor, async (tx) => {
    await requireRole(tx, "company.manage");
    await tx.company.update({ where: { id: actor.companyId }, data: parsed.data });
  });
  return getCompanyProfile(actor);
}
