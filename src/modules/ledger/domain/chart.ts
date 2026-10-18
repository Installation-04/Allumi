import type { AccountSubtype, AccountType, SystemAccount } from "./accounts";

export type ChartAccount = {
  code: string;
  nameFr: string;
  nameEn: string;
  type: AccountType;
  subtype: AccountSubtype;
  systemKey?: SystemAccount;
};

/**
 * Starter chart of accounts for a small Canadian business, written for Allumi (generic account families and
 * the usual 4-digit numbering by type; no third-party chart was copied). Companies edit it freely, except the
 * five system accounts that the engine relies on. Sales-tax accounts are here because the tax module (phase 4)
 * attaches the GST and QST to them.
 */
export const CANADIAN_CHART: readonly ChartAccount[] = [
  // Assets
  { code: "1000", nameFr: "Banque – compte courant", nameEn: "Bank – chequing", type: "ASSET", subtype: "BANK" },
  { code: "1010", nameFr: "Banque – compte d'épargne", nameEn: "Bank – savings", type: "ASSET", subtype: "BANK" },
  { code: "1050", nameFr: "Fonds non déposés", nameEn: "Undeposited funds", type: "ASSET", subtype: "CURRENT_ASSET", systemKey: "UNDEPOSITED_FUNDS" },
  { code: "1100", nameFr: "Comptes clients", nameEn: "Accounts receivable", type: "ASSET", subtype: "ACCOUNTS_RECEIVABLE", systemKey: "ACCOUNTS_RECEIVABLE" },
  { code: "1200", nameFr: "TPS à recevoir", nameEn: "GST receivable", type: "ASSET", subtype: "SALES_TAX" },
  { code: "1210", nameFr: "TVQ à recevoir", nameEn: "QST receivable", type: "ASSET", subtype: "SALES_TAX" },
  { code: "1400", nameFr: "Frais payés d'avance", nameEn: "Prepaid expenses", type: "ASSET", subtype: "CURRENT_ASSET" },
  { code: "1500", nameFr: "Équipement et outillage", nameEn: "Equipment and tools", type: "ASSET", subtype: "FIXED_ASSET" },
  { code: "1510", nameFr: "Matériel informatique", nameEn: "Computer equipment", type: "ASSET", subtype: "FIXED_ASSET" },
  { code: "1590", nameFr: "Amortissement cumulé", nameEn: "Accumulated depreciation", type: "ASSET", subtype: "FIXED_ASSET" },
  // Liabilities
  { code: "2000", nameFr: "Comptes fournisseurs", nameEn: "Accounts payable", type: "LIABILITY", subtype: "ACCOUNTS_PAYABLE", systemKey: "ACCOUNTS_PAYABLE" },
  { code: "2050", nameFr: "Carte de crédit", nameEn: "Credit card", type: "LIABILITY", subtype: "CREDIT_CARD" },
  { code: "2100", nameFr: "TPS à payer", nameEn: "GST payable", type: "LIABILITY", subtype: "SALES_TAX" },
  { code: "2110", nameFr: "TVQ à payer", nameEn: "QST payable", type: "LIABILITY", subtype: "SALES_TAX" },
  { code: "2200", nameFr: "Retenues à la source à payer", nameEn: "Payroll deductions payable", type: "LIABILITY", subtype: "CURRENT_LIABILITY" },
  { code: "2400", nameFr: "Produits perçus d'avance", nameEn: "Deferred revenue", type: "LIABILITY", subtype: "CURRENT_LIABILITY" },
  { code: "2450", nameFr: "Dû aux actionnaires", nameEn: "Due to shareholders", type: "LIABILITY", subtype: "CURRENT_LIABILITY" },
  { code: "2500", nameFr: "Emprunt bancaire", nameEn: "Bank loan", type: "LIABILITY", subtype: "LONG_TERM_LIABILITY" },
  // Equity
  { code: "3000", nameFr: "Capital-actions", nameEn: "Share capital", type: "EQUITY", subtype: "EQUITY" },
  { code: "3100", nameFr: "Capitaux propres – soldes d'ouverture", nameEn: "Equity – opening balances", type: "EQUITY", subtype: "EQUITY", systemKey: "OPENING_BALANCE_EQUITY" },
  { code: "3200", nameFr: "Bénéfices non répartis", nameEn: "Retained earnings", type: "EQUITY", subtype: "RETAINED_EARNINGS", systemKey: "RETAINED_EARNINGS" },
  { code: "3300", nameFr: "Retraits et dividendes", nameEn: "Drawings and dividends", type: "EQUITY", subtype: "EQUITY" },
  // Revenue
  { code: "4000", nameFr: "Revenus de services", nameEn: "Service revenue", type: "REVENUE", subtype: "OPERATING_REVENUE" },
  { code: "4100", nameFr: "Ventes de marchandises", nameEn: "Product sales", type: "REVENUE", subtype: "OPERATING_REVENUE" },
  { code: "4900", nameFr: "Autres revenus", nameEn: "Other revenue", type: "REVENUE", subtype: "OTHER_REVENUE" },
  { code: "4910", nameFr: "Revenus d'intérêts", nameEn: "Interest income", type: "REVENUE", subtype: "OTHER_REVENUE" },
  // Cost of sales
  { code: "5000", nameFr: "Coût des marchandises vendues", nameEn: "Cost of goods sold", type: "EXPENSE", subtype: "COST_OF_SALES" },
  { code: "5100", nameFr: "Sous-traitance", nameEn: "Subcontractors", type: "EXPENSE", subtype: "COST_OF_SALES" },
  // Operating expenses
  { code: "6000", nameFr: "Publicité et promotion", nameEn: "Advertising and promotion", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6010", nameFr: "Frais bancaires", nameEn: "Bank charges", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6020", nameFr: "Assurances", nameEn: "Insurance", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6030", nameFr: "Honoraires professionnels", nameEn: "Professional fees", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6040", nameFr: "Fournitures de bureau", nameEn: "Office supplies", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6050", nameFr: "Loyer", nameEn: "Rent", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6060", nameFr: "Télécommunications", nameEn: "Telecommunications", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6070", nameFr: "Déplacements", nameEn: "Travel", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6080", nameFr: "Repas et représentation", nameEn: "Meals and entertainment", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6090", nameFr: "Électricité et chauffage", nameEn: "Utilities", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6100", nameFr: "Salaires et avantages sociaux", nameEn: "Wages and benefits", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6110", nameFr: "Entretien et réparations", nameEn: "Repairs and maintenance", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6120", nameFr: "Logiciels et abonnements", nameEn: "Software and subscriptions", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6130", nameFr: "Formation", nameEn: "Training", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6140", nameFr: "Permis et cotisations", nameEn: "Licences and dues", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6900", nameFr: "Amortissement", nameEn: "Depreciation", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6950", nameFr: "Mauvaises créances", nameEn: "Bad debts", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  // Other expenses
  { code: "7000", nameFr: "Intérêts sur emprunts", nameEn: "Interest on loans", type: "EXPENSE", subtype: "OTHER_EXPENSE" },
  { code: "7900", nameFr: "Autres charges", nameEn: "Other expenses", type: "EXPENSE", subtype: "OTHER_EXPENSE" },
];
