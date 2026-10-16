import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "./password";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const setupSchema = z
  .object({
    companyName: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(120),
    email,
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    passwordConfirm: z.string(),
    locale: z.enum(["fr-CA", "en"]),
    fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  })
  .refine((value) => value.password === value.passwordConfirm, { path: ["passwordConfirm"], message: "mismatch" });

export const codeSchema = z.object({ code: z.string().trim().min(6).max(20) });

export type LoginInput = z.infer<typeof loginSchema>;
export type SetupInput = z.infer<typeof setupSchema>;
