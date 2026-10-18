import { z } from "zod";
import { gstNumberSchema, normalizePostalCode, optionalEmail, optionalText, PROVINCES, qstNumberSchema } from "@/modules/companies/client";

export const CONTACT_LOCALES = ["fr_CA", "en"] as const;

const province = z
  .union([z.enum(PROVINCES), z.literal("")])
  .nullish()
  .transform((value) => (value ? value : null));

const country = z
  .string()
  .nullish()
  .transform((value) => (value ?? "").trim().toUpperCase() || "CA")
  .refine((value) => /^[A-Z]{2}$/.test(value), { message: "country" });

/**
 * A customer and/or a supplier. The registration numbers of a supplier are kept to justify the tax a purchase claims back
 * (input tax credits / refunds); the postal code is normalized for Canada and left alone elsewhere.
 */
export const contactInputSchema = z
  .object({
    isCustomer: z.boolean(),
    isSupplier: z.boolean(),
    displayName: z.string().trim().min(1).max(120),
    legalName: optionalText(160),
    email: optionalEmail,
    phone: optionalText(40),
    addressLine1: optionalText(120),
    addressLine2: optionalText(120),
    city: optionalText(80),
    province,
    postalCode: optionalText(12),
    country,
    locale: z.enum(CONTACT_LOCALES).default("fr_CA"),
    defaultTaxCodeId: z.uuid().nullish().transform((value) => value ?? null),
    paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
    gstNumber: gstNumberSchema,
    qstNumber: qstNumberSchema,
    taxExemptionNumber: optionalText(40),
    notes: optionalText(1000),
  })
  .refine((contact) => contact.isCustomer || contact.isSupplier, { path: ["isCustomer"], message: "role" })
  .transform((contact, context) => {
    if (contact.postalCode !== null && contact.country === "CA") {
      const normalized = normalizePostalCode(contact.postalCode);
      if (!normalized) context.addIssue({ code: "custom", path: ["postalCode"], message: "postalCode" });
      return { ...contact, postalCode: normalized };
    }
    return contact;
  });

export type ContactInput = z.input<typeof contactInputSchema>;
export type ContactData = z.output<typeof contactInputSchema>;

/** Columns that hold personal data: erased when a contact is anonymized, and redacted from the audit trail (Law 25). */
export const CONTACT_PERSONAL_COLUMNS = [
  "display_name",
  "legal_name",
  "email",
  "phone",
  "address_line1",
  "address_line2",
  "city",
  "postal_code",
  "gst_number",
  "qst_number",
  "tax_exemption_number",
  "notes",
] as const;

export const CONTACT_FILTERS = ["all", "customers", "suppliers"] as const;
export type ContactFilter = (typeof CONTACT_FILTERS)[number];
