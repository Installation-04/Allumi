import { z } from "zod";

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_SUBTYPES = [
  "CASH",
  "BANK",
  "ACCOUNTS_RECEIVABLE",
  "CURRENT_ASSET",
  "FIXED_ASSET",
  "OTHER_ASSET",
  "CREDIT_CARD",
  "ACCOUNTS_PAYABLE",
  "SALES_TAX",
  "CURRENT_LIABILITY",
  "LONG_TERM_LIABILITY",
  "EQUITY",
  "RETAINED_EARNINGS",
  "OPERATING_REVENUE",
  "OTHER_REVENUE",
  "COST_OF_SALES",
  "OPERATING_EXPENSE",
  "OTHER_EXPENSE",
] as const;
export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[number];

export const SYSTEM_ACCOUNTS = ["ACCOUNTS_RECEIVABLE", "ACCOUNTS_PAYABLE", "UNDEPOSITED_FUNDS", "RETAINED_EARNINGS", "OPENING_BALANCE_EQUITY"] as const;
export type SystemAccount = (typeof SYSTEM_ACCOUNTS)[number];

/** The subtypes a type accepts: the same table as the CHECK account_subtype_matches_type. */
export const SUBTYPES_OF: Record<AccountType, readonly AccountSubtype[]> = {
  ASSET: ["CASH", "BANK", "ACCOUNTS_RECEIVABLE", "CURRENT_ASSET", "FIXED_ASSET", "OTHER_ASSET", "SALES_TAX"],
  LIABILITY: ["CREDIT_CARD", "ACCOUNTS_PAYABLE", "SALES_TAX", "CURRENT_LIABILITY", "LONG_TERM_LIABILITY"],
  EQUITY: ["EQUITY", "RETAINED_EARNINGS"],
  REVENUE: ["OPERATING_REVENUE", "OTHER_REVENUE"],
  EXPENSE: ["COST_OF_SALES", "OPERATING_EXPENSE", "OTHER_EXPENSE"],
};

export const ACCOUNT_CODE = /^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/;

/** The first code from `wanted` upwards that is not in `taken` (1100 -> 1101 when 1100 is used; "X" -> "X-1" for a non-numeric code). */
export function nextFreeCode(taken: ReadonlySet<string>, wanted: string): string {
  let code = wanted;
  for (let attempt = 0; taken.has(code); attempt++) code = /^[0-9]+$/.test(wanted) ? String(Number(wanted) + attempt + 1) : `${wanted}-${attempt + 1}`;
  return code;
}

/**
 * Subtypes an ordinary user cannot create: receivables and payables are control accounts (one per company,
 * created by the system), and sales-tax accounts come with the taxes (phase 4).
 */
const RESERVED_SUBTYPES: readonly AccountSubtype[] = ["ACCOUNTS_RECEIVABLE", "ACCOUNTS_PAYABLE", "SALES_TAX", "RETAINED_EARNINGS"];

export function userCreatableSubtypes(type: AccountType): AccountSubtype[] {
  return SUBTYPES_OF[type].filter((subtype) => !RESERVED_SUBTYPES.includes(subtype));
}

/** Accounts a manual entry may use: not control accounts (documents and payments only), not tax accounts. */
export function acceptsManualEntries(account: { subtype: AccountSubtype; isActive: boolean }): boolean {
  return account.isActive && account.subtype !== "ACCOUNTS_RECEIVABLE" && account.subtype !== "ACCOUNTS_PAYABLE" && account.subtype !== "SALES_TAX";
}

/** Debit-normal accounts grow with debits (assets, expenses); the others with credits. */
export function isDebitNormal(type: AccountType): boolean {
  return type === "ASSET" || type === "EXPENSE";
}

const name = z.string().trim().min(1).max(120);

const accountFields = z.object({
  code: z.string().trim().regex(ACCOUNT_CODE),
  nameFr: name,
  nameEn: name,
  type: z.enum(ACCOUNT_TYPES),
  subtype: z.enum(ACCOUNT_SUBTYPES),
  parentId: z.uuid().nullish(),
  description: z.string().trim().max(500).nullish(),
});

export const accountInputSchema = accountFields.refine((account) => userCreatableSubtypes(account.type).includes(account.subtype), {
  path: ["subtype"],
  message: "subtype",
});

/** What can change on an existing account: type and subtype are frozen once the account has postings. */
export const accountPatchSchema = accountFields
  .pick({ code: true, nameFr: true, nameEn: true, parentId: true, description: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

export type AccountInput = z.infer<typeof accountInputSchema>;
export type AccountPatch = z.infer<typeof accountPatchSchema>;
