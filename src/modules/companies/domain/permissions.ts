import { moduleLevel, type AccessContext, type Module } from "./module-access";
// Who may do what in a company. The database enforces the core of this matrix with row level security
// (everybody reads; the owner and the accountant write; only the owner manages the company); the application
// uses it to show the right buttons and to refuse early with a clear message.

export type Role = "OWNER" | "USER" | "ACCOUNTANT" | "READ_ONLY";

export type Action =
  | "bank.read"
  | "bank.manage"
  | "integration.manage"
  | "members.manage"
  | "taxes.read"
  | "taxes.manage"
  | "sales.read"
  | "sales.manage"
  | "company.read"
  | "company.manage"
  | "catalog.read"
  | "catalog.manage"
  | "contact.read"
  | "contact.manage"
  | "ledger.read"
  | "entry.post"
  | "entry.reverse"
  | "account.manage"
  | "period.lock"
  | "period.reopen"
  | "fiscalYear.create"
  | "fiscalYear.close"
  | "fiscalYear.reopen"
  | "audit.read";

const ALLOWED: Record<Action, readonly Role[]> = {
  "bank.read": ["OWNER", "USER", "ACCOUNTANT", "READ_ONLY"],
  "bank.manage": ["OWNER", "ACCOUNTANT"],
  "integration.manage": ["OWNER"],
  "members.manage": ["OWNER"],
  "taxes.read": ["OWNER", "USER", "ACCOUNTANT", "READ_ONLY"],
  "taxes.manage": ["OWNER", "ACCOUNTANT"],
  "sales.read": ["OWNER", "USER", "ACCOUNTANT", "READ_ONLY"],
  "sales.manage": ["OWNER", "ACCOUNTANT"],
  "company.read": ["OWNER", "USER", "ACCOUNTANT", "READ_ONLY"],
  "company.manage": ["OWNER"],
  "catalog.read": ["OWNER", "USER", "ACCOUNTANT", "READ_ONLY"],
  "catalog.manage": ["OWNER", "USER", "ACCOUNTANT"],
  "contact.read": ["OWNER", "USER", "ACCOUNTANT", "READ_ONLY"],
  "contact.manage": ["OWNER", "USER", "ACCOUNTANT"],
  "ledger.read": ["OWNER", "USER", "ACCOUNTANT", "READ_ONLY"],
  "entry.post": ["OWNER", "ACCOUNTANT"],
  "entry.reverse": ["OWNER", "ACCOUNTANT"],
  "account.manage": ["OWNER", "ACCOUNTANT"],
  "period.lock": ["OWNER", "ACCOUNTANT"],
  "fiscalYear.create": ["OWNER", "ACCOUNTANT"],
  "fiscalYear.close": ["OWNER"],
  // Reopening unlocks the past: owner only, and the service also asks for two-factor authentication and a reason.
  "period.reopen": ["OWNER"],
  "fiscalYear.reopen": ["OWNER"],
  "audit.read": ["OWNER", "ACCOUNTANT"],
};

export function can(subject: Role | AccessContext, action: Action): boolean {
  const context = typeof subject === "string" ? { role: subject } : subject;
  const ownerOnly: Action[] = ["integration.manage", "members.manage", "company.manage", "period.reopen", "fiscalYear.reopen", "fiscalYear.close"];
  if (ownerOnly.includes(action)) return context.role === "OWNER";
  if (action === "company.read") return true;
  const prefix = action.split(".")[0];
  const module: Module = prefix === "contact" ? "contacts" : prefix === "catalog" ? "catalog" : prefix === "sales" ? "sales" : prefix === "taxes" ? "taxes" : prefix === "audit" ? "audit" : "accounting";
  const level = moduleLevel(context, module);
  return action.endsWith(".read") ? level !== "none" : level === "write";
}

export const ACTIONS = Object.keys(ALLOWED) as Action[];
