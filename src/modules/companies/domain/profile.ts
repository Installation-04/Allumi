import { z } from "zod";
import { businessNumberSchema, gstNumberSchema, neqSchema, normalizePostalCode, qstNumberSchema } from "./registration";

export const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"] as const;
export type ProvinceCode = (typeof PROVINCES)[number];
export const LOCALES = ["fr_CA", "en"] as const;
export const TAX_ROUNDINGS = ["PER_LINE", "PER_DOCUMENT"] as const;
export const FILING_FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;

export const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((value) => {
      const trimmed = (value ?? "").trim();
      return trimmed === "" ? null : trimmed;
    })
    .refine((value) => value === null || value.length <= max, { message: "tooLong" });

export const optionalEmail = optionalText(254).refine((value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), { message: "email" });

export const optionalPostalCode = optionalText(10).transform((value, context) => {
  if (value === null) return null;
  const normalized = normalizePostalCode(value);
  if (!normalized) context.addIssue({ code: "custom", message: "postalCode" });
  return normalized;
});

/** The company's identity and its tax settings: what is printed on documents and how the taxes are rounded. */
export const companyProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: optionalText(160),
  neq: neqSchema,
  businessNumber: businessNumberSchema,
  gstNumber: gstNumberSchema,
  qstNumber: qstNumberSchema,
  addressLine1: optionalText(120),
  addressLine2: optionalText(120),
  city: optionalText(80),
  province: z.enum(PROVINCES),
  postalCode: optionalPostalCode,
  email: optionalEmail,
  phone: optionalText(40),
  defaultLocale: z.enum(LOCALES),
  taxRounding: z.enum(TAX_ROUNDINGS),
  taxFilingFrequency: z.enum(FILING_FREQUENCIES),
});

export type CompanyProfileInput = z.input<typeof companyProfileSchema>;
export type CompanyProfile = z.output<typeof companyProfileSchema> & { id: string; fiscalYearStartMonth: number };
