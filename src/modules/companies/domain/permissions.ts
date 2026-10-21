// Who may do what in a company. The database enforces the core of this matrix with row level security
// (everybody reads; the owner and the accountant write; only the owner manages the company); the application
// uses it to show the right buttons and to refuse early with a clear message.

export type Role = "OWNER" | "ACCOUNTANT" | "READ_ONLY";

export type Action =
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
  "company.read": ["OWNER", "ACCOUNTANT", "READ_ONLY"],
  "company.manage": ["OWNER"],
  "catalog.read": ["OWNER", "ACCOUNTANT", "READ_ONLY"],
  "catalog.manage": ["OWNER", "ACCOUNTANT"],
  "contact.read": ["OWNER", "ACCOUNTANT", "READ_ONLY"],
  "contact.manage": ["OWNER", "ACCOUNTANT"],
  "ledger.read": ["OWNER", "ACCOUNTANT", "READ_ONLY"],
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

export function can(role: Role, action: Action): boolean {
  return ALLOWED[action].includes(role);
}

export const ACTIONS = Object.keys(ALLOWED) as Action[];
