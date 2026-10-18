import { z } from "zod";
import { isValidIsoDate } from "@/modules/ledger/client";
import { MAX_RATE_MICRO } from "./rates";

const name = z.string().trim().min(1).max(80);

export const TAX_TREATMENTS = ["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"] as const;

export const TAX_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,15}$/;
export const TAX_CODE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9+-]{0,23}$/;

const isoDate = z.string().refine(isValidIsoDate, { message: "date" });
const rateMicro = z.bigint().min(0n).max(MAX_RATE_MICRO);

/** A new tax with its first rate. The accounts are given, or created for it (see the service). */
export const taxInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(TAX_CODE_PATTERN),
  nameFr: name,
  nameEn: name,
  registrationNumber: z
    .string()
    .nullish()
    .transform((value) => {
      const trimmed = (value ?? "").trim();
      return trimmed === "" ? null : trimmed;
    })
    .refine((value) => value === null || value.length <= 40, { message: "tooLong" }),
  rateMicro,
  from: isoDate,
  payableAccountId: z.uuid().nullish(),
  recoverableAccountId: z.uuid().nullish(),
  /** When no payable account is given, create the recoverable one too (a purchase can claim the tax back). */
  recoverable: z.boolean().default(true),
});
export type TaxInput = z.input<typeof taxInputSchema>;

export const taxPatchSchema = z.object({
  nameFr: name.optional(),
  nameEn: name.optional(),
  registrationNumber: taxInputSchema.shape.registrationNumber.optional(),
  isActive: z.boolean().optional(),
});
export type TaxPatch = z.input<typeof taxPatchSchema>;

export const taxRateInputSchema = z.object({ rateMicro, from: isoDate });

export const taxCodeInputSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(TAX_CODE_CODE_PATTERN),
    nameFr: name,
    nameEn: name,
    treatment: z.enum(TAX_TREATMENTS),
    taxIds: z.array(z.uuid()).max(10),
  })
  .refine((code) => (code.treatment === "STANDARD" ? code.taxIds.length > 0 : code.taxIds.length === 0), { path: ["taxIds"], message: "components" })
  .refine((code) => new Set(code.taxIds).size === code.taxIds.length, { path: ["taxIds"], message: "duplicate" });
export type TaxCodeInput = z.input<typeof taxCodeInputSchema>;

export const taxCodePatchSchema = z.object({ nameFr: name.optional(), nameEn: name.optional(), isActive: z.boolean().optional() });
export type TaxCodePatch = z.input<typeof taxCodePatchSchema>;
