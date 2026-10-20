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
