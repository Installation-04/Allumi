import { z } from "zod";
import { contactSchema, type ContactInput, PROVINCES } from "@/modules/contacts/client";
import { itemSchema } from "@/modules/taxes/client";
import { ACCOUNT_CODE, ACCOUNT_TYPES, ACCOUNT_SUBTYPES, SUBTYPES_OF, type AccountType, type AccountSubtype } from "@/modules/ledger/client";
import { MigrationCsvError, readMigrationCsv } from "./csv";

export const MIGRATION_KINDS = ["CUSTOMERS", "SUPPLIERS", "ITEMS", "ACCOUNTS", "BALANCES"] as const;
export type MigrationKind = typeof MIGRATION_KINDS[number];
export const FIELDS = ["name", "legalName", "email", "phone", "address1", "address2", "city", "province", "postalCode", "country", "language", "terms", "code", "description", "price", "incomeAccount", "expenseAccount", "taxCode", "accountType", "accountSubtype", "itemType", "currency", "debit", "credit"] as const;
export type MigrationField = typeof FIELDS[number];
const contactFields: MigrationField[] = ["name", "legalName", "email", "phone", "address1", "address2", "city", "province", "postalCode", "country", "language", "terms", "currency"];
export function fieldsFor(kind: MigrationKind): readonly MigrationField[] {
  return kind === "BALANCES" ? ["name", "code", "debit", "credit", "currency"] : kind === "CUSTOMERS" || kind === "SUPPLIERS" ? contactFields : kind === "ITEMS" ? ["name", "code", "description", "price", "incomeAccount", "expenseAccount", "taxCode", "itemType", "currency"] : ["name", "code", "description", "accountType", "accountSubtype", "currency"];
}
export const migrationSpec = z.object({
  source: z.enum(["ONLINE", "DESKTOP"]), kind: z.enum(MIGRATION_KINDS), delimiter: z.enum([",", ";", "\t"]),
  format: z.enum(["en", "fr-CA"]), headerRecord: z.number().int().min(1).max(20).default(1),
  mapping: z.partialRecord(z.enum(FIELDS), z.number().int().min(0).max(49)),
  defaultLocale: z.enum(["fr_CA", "en"]), skipExisting: z.boolean(), cutoverDate: z.string().max(10).default(""),
}).strict();
export type MigrationSpec = z.infer<typeof migrationSpec>;
export const identityKey = (text: string) => text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-CA");
const aliasKey = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<MigrationField, string[]> = {
  name: ["Name", "Full name", "Customer", "Customer name", "Vendor", "Vendor name", "Supplier", "Item", "Item name", "Product/Service", "Product/Service name", "Account", "Account name", "Nom", "Client", "Fournisseur", "Produit/Service", "Compte"],
  legalName: ["Company", "Company name", "Legal name", "Société", "Nom légal", "Entreprise"],
  email: ["Email", "E-mail", "Main email", "Courriel", "Adresse e-mail"], phone: ["Phone", "Main phone", "Telephone", "Téléphone"],
  address1: ["Bill street", "Billing address", "Billing address 1", "Street", "Address", "Address 1", "Adresse", "Adresse de facturation"],
  address2: ["Billing address 2", "Address 2", "Adresse 2"], city: ["Bill city", "Billing city", "City", "Ville"],
  province: ["Bill state", "Billing state", "State", "Province"], postalCode: ["Bill zip", "Billing postal code", "Zip", "Postal code", "Code postal"],
  country: ["Bill country", "Billing country", "Country", "Pays"], language: ["Language", "Langue"], terms: ["Terms", "Payment terms", "Échéance", "Conditions de paiement"],
  code: ["SKU", "Item code", "Account #", "Account number", "Numéro de compte", "Code"], description: ["Description", "Sales description", "Description de vente"],
  price: ["Sales price", "Sales price/rate", "Price", "Rate", "Prix", "Prix de vente", "Tarif"],
  incomeAccount: ["Income account", "Compte de revenus"], expenseAccount: ["Expense account", "COGS account", "Compte de charges"],
  taxCode: ["Tax code", "Sales tax code", "Code de taxe"], accountType: ["Account type", "Type de compte", "Type"],
  accountSubtype: ["Allumi subtype", "Sous-type Allumi"], itemType: ["Item type", "Product/service type", "Type"], currency: ["Currency", "Currency code", "Devise"], debit: ["Debit", "Debits", "Débit"], credit: ["Credit", "Credits", "Crédit"],
};
export function suggestMapping(headers: readonly string[], kind: MigrationKind): Partial<Record<MigrationField, number>> {
  return Object.fromEntries(fieldsFor(kind).flatMap(field => {
    const matches = headers.flatMap((h, i) => ALIASES[field].some(a => aliasKey(a) === aliasKey(h)) ? [i] : []);
    return matches.length === 1 ? [[field, matches[0]!]] : [];
  }));
}
const TYPE_ALIASES: Record<string, [AccountType, AccountSubtype]> = {
  bank: ["ASSET", "BANK"], banque: ["ASSET", "BANK"], cash: ["ASSET", "CASH"],
  accountsreceivablear: ["ASSET", "ACCOUNTS_RECEIVABLE"], accountsreceivable: ["ASSET", "ACCOUNTS_RECEIVABLE"], comptesclients: ["ASSET", "ACCOUNTS_RECEIVABLE"],
  othercurrentasset: ["ASSET", "CURRENT_ASSET"], othercurrentassets: ["ASSET", "CURRENT_ASSET"], autresactifscourtterme: ["ASSET", "CURRENT_ASSET"],
  fixedasset: ["ASSET", "FIXED_ASSET"], fixedassets: ["ASSET", "FIXED_ASSET"], immobilisations: ["ASSET", "FIXED_ASSET"],
  otherasset: ["ASSET", "OTHER_ASSET"], otherassets: ["ASSET", "OTHER_ASSET"], autresactifs: ["ASSET", "OTHER_ASSET"],
  creditcard: ["LIABILITY", "CREDIT_CARD"], cartedecredit: ["LIABILITY", "CREDIT_CARD"],
  accountspayableap: ["LIABILITY", "ACCOUNTS_PAYABLE"], accountspayable: ["LIABILITY", "ACCOUNTS_PAYABLE"], comptesfournisseurs: ["LIABILITY", "ACCOUNTS_PAYABLE"],
  othercurrentliability: ["LIABILITY", "CURRENT_LIABILITY"], othercurrentliabilities: ["LIABILITY", "CURRENT_LIABILITY"], autrespassifscourtterme: ["LIABILITY", "CURRENT_LIABILITY"],
  longtermliability: ["LIABILITY", "LONG_TERM_LIABILITY"], longtermliabilities: ["LIABILITY", "LONG_TERM_LIABILITY"], passifslongterme: ["LIABILITY", "LONG_TERM_LIABILITY"],
  equity: ["EQUITY", "EQUITY"], capitauxpropres: ["EQUITY", "EQUITY"],
  income: ["REVENUE", "OPERATING_REVENUE"], revenus: ["REVENUE", "OPERATING_REVENUE"], otherincome: ["REVENUE", "OTHER_REVENUE"], autresrevenus: ["REVENUE", "OTHER_REVENUE"],
  costofgoodssold: ["EXPENSE", "COST_OF_SALES"], coutdesventes: ["EXPENSE", "COST_OF_SALES"], expenses: ["EXPENSE", "OPERATING_EXPENSE"], depenses: ["EXPENSE", "OPERATING_EXPENSE"],
  otherexpense: ["EXPENSE", "OTHER_EXPENSE"], otherexpenses: ["EXPENSE", "OTHER_EXPENSE"], autrescharges: ["EXPENSE", "OTHER_EXPENSE"],
};
const DEFAULT_SUBTYPE: Record<AccountType, AccountSubtype> = { ASSET: "OTHER_ASSET", LIABILITY: "CURRENT_LIABILITY", EQUITY: "EQUITY", REVENUE: "OPERATING_REVENUE", EXPENSE: "OPERATING_EXPENSE" };
const PROVINCE_NAMES = ["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Nova Scotia", "Northwest Territories", "Nunavut", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan", "Yukon"];
export type MigrationRow =
 | { kind: "CUSTOMERS" | "SUPPLIERS"; row: number; key: string; name: string; data: ContactInput }
 | { kind: "ITEMS"; row: number; key: string; name: string; data: z.output<typeof itemSchema>; refs: { income: string; expense: string; tax: string } }
 | { kind: "BALANCES"; row: number; key: string; name: string; data: { code: string; debitCents: string; creditCents: string } }
 | { kind: "ACCOUNTS"; row: number; key: string; name: string; data: { code: string; nameFr: string; nameEn: string; type: AccountType; subtype: AccountSubtype; description: string | null; parentId: null } };

export function prepareMigration(text: string, input: unknown) {
  const parsed = migrationSpec.safeParse(input); if (!parsed.success) throw new MigrationCsvError("mapping");
  const spec = parsed.data, csv = readMigrationCsv(text, spec.delimiter, spec.headerRecord), allowed = fieldsFor(spec.kind);
  if (Object.entries(spec.mapping).some(([field, col]) => !allowed.includes(field as MigrationField) || col === undefined || col >= csv.headers.length)) throw new MigrationCsvError("mapping");
  const required: MigrationField[] = [...(spec.kind === "BALANCES" ? ["code", "debit", "credit"] as const : ["name"] as const), ...(spec.kind === "ACCOUNTS" ? ["code", "accountType"] as const : []), ...(spec.kind === "ITEMS" ? ["price"] as const : [])];
  for (const field of ["currency", ...(spec.kind === "ITEMS" ? ["itemType"] as const : [])] as MigrationField[]) {
    if (csv.headers.some(h => ALIASES[field].some(a => aliasKey(a) === aliasKey(h)))) required.push(field);
  }
  if (required.some(f => spec.mapping[f] === undefined)) throw new MigrationCsvError("mapping");
  const keys = new Set<string>();
  const rows: MigrationRow[] = csv.rows.map(record => {
    const get = (f: MigrationField) => spec.mapping[f] === undefined ? "" : record.cells[spec.mapping[f]!]!.normalize("NFC").trim();
    const fail = (field: string, code: "invalid" | "currency" | "inventory" = "invalid"): never => { throw new MigrationCsvError(code, record.row, field); };
    const currency = get("currency"); if (currency && currency.toUpperCase() !== "CAD") fail("currency", "currency");
    const name = get("name");
    let result: MigrationRow;
    if (spec.kind === "BALANCES") {
      const code = get("code"); if (!ACCOUNT_CODE.test(code)) fail("code");
      const money = (value: string, field: string) => {
        if (!value) return 0n;
        const pattern = spec.format === "en" ? /^\d{1,12}(?:\.\d{1,2})?$/ : /^\d{1,12}(?:,\d{1,2})?$/;
        if (!pattern.test(value)) return fail(field);
        const [whole, fraction = ""] = value.replace(",", ".").split(".");
        return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
      };
      const debit = money(get("debit"), "debit"), credit = money(get("credit"), "credit");
      if (debit && credit) fail("debit");
      result = { kind: "BALANCES", row: record.row, key: code, name: name || code, data: { code, debitCents: debit.toString(), creditCents: credit.toString() } };
    } else if (spec.kind === "CUSTOMERS" || spec.kind === "SUPPLIERS") {
      const state = get("province"), province = !state ? null : PROVINCES.includes(state.toUpperCase() as typeof PROVINCES[number]) ? state.toUpperCase() : PROVINCES[PROVINCE_NAMES.findIndex(p => aliasKey(p) === aliasKey(state))] ?? (aliasKey(state) === "quebec" ? "QC" : null);
      if (state && !province) fail("province");
      const language = aliasKey(get("language"));
      const locale = !language ? spec.defaultLocale : ["en", "enca", "english", "anglais"].includes(language) ? "en" : ["fr", "frca", "french", "francais"].includes(language) ? "fr_CA" : fail("language");
      const rawTerms = get("terms"), terms = !rawTerms ? 30 : /^(?:net\s*)?\d{1,3}$/i.test(rawTerms) ? Number(rawTerms.replace(/net\s*/i, "")) : ["dueonreceipt", "payablealareception"].includes(aliasKey(rawTerms)) ? 0 : fail("terms");
      const countryRaw = get("country"), country = !countryRaw ? "CA" : ["canada", "can"].includes(aliasKey(countryRaw)) ? "CA" : ["unitedstates", "usa", "etatsunis"].includes(aliasKey(countryRaw)) ? "US" : countryRaw.toUpperCase();
      const data = contactSchema.safeParse({ kind: spec.kind === "CUSTOMERS" ? "CUSTOMER" : "SUPPLIER", displayName: name, legalName: get("legalName"), email: get("email"), phone: get("phone"), addressLine1: get("address1"), addressLine2: get("address2"), city: get("city"), province, postalCode: get("postalCode"), country, locale, paymentTermsDays: terms, notes: null });
      if (!data.success) fail(String(data.error.issues[0]?.path[0] ?? "name"));
      result = { kind: spec.kind, row: record.row, key: identityKey(name), name, data: data.data! };
    } else if (spec.kind === "ITEMS") {
      const type = aliasKey(get("itemType")); if (type && !["service", "services", "noninventory", "noninventorypart", "nonstock", "nonstockitem", "horsstock", "produitnonstocke"].includes(type)) fail("itemType", "inventory");
      const price = get("price"), pattern = spec.format === "en" ? /^\d{1,12}(?:\.\d{1,6})?$/ : /^\d{1,12}(?:,\d{1,6})?$/;
      if (!pattern.test(price)) fail("price");
      const data = itemSchema.safeParse({ code: get("code"), name, description: get("description"), unitPrice: price.replace(",", "."), incomeAccountId: "", expenseAccountId: "", defaultTaxCodeId: "" });
      if (!data.success) fail(String(data.error.issues[0]?.path[0] ?? "name"));
      result = { kind: "ITEMS", row: record.row, key: identityKey(get("code") || name), name, data: data.data!, refs: { income: get("incomeAccount"), expense: get("expenseAccount"), tax: get("taxCode") } };
    } else {
      const rawType = get("accountType"), pair = TYPE_ALIASES[aliasKey(rawType)], upper = rawType.toUpperCase();
      const type = pair?.[0] ?? (ACCOUNT_TYPES.includes(upper as AccountType) ? upper as AccountType : fail("accountType"));
      const rawSubtype = get("accountSubtype"), subtype = rawSubtype ? rawSubtype.toUpperCase() as AccountSubtype : pair?.[1] ?? DEFAULT_SUBTYPE[type];
      if (!ACCOUNT_SUBTYPES.includes(subtype) || !SUBTYPES_OF[type].includes(subtype)) fail("accountSubtype");
      const code = get("code"), description = get("description");
      if (!ACCOUNT_CODE.test(code)) fail("code"); if (!name || name.length > 120) fail("name"); if (description.length > 500) fail("description");
      result = { kind: "ACCOUNTS", row: record.row, key: code, name, data: { code, nameFr: name, nameEn: name, type, subtype, description: description || null, parentId: null } };
    }
    if (!result.key || keys.has(result.key)) throw new MigrationCsvError("duplicate", record.row, "name"); keys.add(result.key);
    return result;
  });
  if (spec.kind === "BALANCES") {
    if (rows.length > 500) throw new MigrationCsvError("rows");
    let debit = 0n, credit = 0n;
    for (const row of rows) if (row.kind === "BALANCES") { debit += BigInt(row.data.debitCents); credit += BigInt(row.data.creditCents); }
    if (debit !== credit) throw new MigrationCsvError("invalid", 0, "balance");
  }
  const used = new Set(Object.values(spec.mapping));
  const ignored = csv.headers.flatMap((header, i) => !used.has(i) && csv.rows.some(r => Boolean(r.cells[i])) ? [{ column: i, header: header || `#${i + 1}` }] : []);
  return { spec, rows, headers: csv.headers, ignored };
}
