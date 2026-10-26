import { z } from "zod";

export const CONTACT_KINDS = ["CUSTOMER", "SUPPLIER", "BOTH"] as const;
export const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"] as const;
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);

export const contactSchema = z.object({
  kind: z.enum(CONTACT_KINDS),
  displayName: z.string().trim().min(1).max(200),
  legalName: optionalText(200),
  email: optionalText(254).refine((value) => value === null || z.email().safeParse(value).success),
  phone: optionalText(40),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  province: z.enum(PROVINCES).nullable().optional().transform((value) => value ?? null),
  postalCode: optionalText(20),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("CA"),
  locale: z.enum(["fr_CA", "en"]).default("fr_CA"),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  notes: optionalText(5000),
});

export const contactFilterSchema = z.object({
  q: z.string().trim().max(100).default(""),
  kind: z.enum(["ALL", "CUSTOMER", "SUPPLIER"]).default("ALL"),
  status: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).default("ACTIVE"),
  page: z.number().int().min(1).max(100000).default(1),
});
export type ContactInput = z.output<typeof contactSchema>;
export type ContactFilter = z.output<typeof contactFilterSchema>;

/**
 * Law 25: the columns of `contact` that identify a person (database names, which are also the keys of the audit
 * trail's before/after). Anonymizing clears them in the row AND removes them from every audit entry of the contact.
 * Notes and registration numbers count: free text names people, and a sole proprietor's GST/QST number is theirs.
 */
export const PERSONAL_COLUMNS = [
  "display_name", "legal_name", "email", "phone", "address_line1", "address_line2", "city", "province",
  "postal_code", "notes", "gst_number", "qst_number", "tax_exemption_number",
] as const;

/** The columns that stay: no personal data, or what keeps accounting documents and tax rules consistent. */
export const RETAINED_COLUMNS = [
  "id", "company_id", "is_customer", "is_supplier", "country", "locale", "default_tax_code_id", "payment_terms_days",
  "is_active", "anonymized_at", "created_at", "updated_at",
] as const;

export const ANONYMIZED_NAME = "Contact anonymisé";

/** A fixed list, not free text: a reason typed into the audit trail could itself name the person being forgotten. */
export const ANONYMIZATION_REASONS = ["SUBJECT_REQUEST", "RETENTION_ENDED", "OTHER"] as const;
export const anonymizeSchema = z.object({ reason: z.enum(ANONYMIZATION_REASONS), confirm: z.literal("yes") });
export type AnonymizationReason = (typeof ANONYMIZATION_REASONS)[number];
