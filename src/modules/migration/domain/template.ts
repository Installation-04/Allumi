import { z } from "zod";
import { fieldsFor, MIGRATION_KINDS, type MigrationField } from "./mapping";

export const migrationTemplateOptions = z.object({
  kind: z.enum(MIGRATION_KINDS),
  locale: z.enum(["fr-CA", "en"]),
  delimiter: z.enum([",", ";", "\t"]),
}).strict();

// Import aliases, rather than UI labels: every header must map back without guessing.
const HEADERS: Record<"fr-CA" | "en", Record<MigrationField, string>> = {
  "fr-CA": {
    name: "Nom", legalName: "Nom légal", email: "Courriel", phone: "Téléphone",
    address1: "Adresse de facturation", address2: "Adresse 2", city: "Ville", province: "Province",
    postalCode: "Code postal", country: "Pays", language: "Langue", terms: "Conditions de paiement",
    code: "Code", description: "Description", price: "Prix de vente", incomeAccount: "Compte de revenus",
    expenseAccount: "Compte de charges", taxCode: "Code de taxe", accountType: "Type de compte",
    accountSubtype: "Sous-type Allumi", itemType: "Type", currency: "Devise", debit: "Débit", credit: "Crédit",
  },
  en: {
    name: "Name", legalName: "Company", email: "Email", phone: "Phone",
    address1: "Billing address", address2: "Address 2", city: "City", province: "Province",
    postalCode: "Postal code", country: "Country", language: "Language", terms: "Terms",
    code: "Code", description: "Description", price: "Sales price", incomeAccount: "Income account",
    expenseAccount: "Expense account", taxCode: "Tax code", accountType: "Account type",
    accountSubtype: "Allumi subtype", itemType: "Item type", currency: "Currency", debit: "Debit", credit: "Credit",
  },
};

/** A single UTF-8 header record, with no fictional or company data to import accidentally. */
export function migrationCsvTemplate(input: unknown): string {
  const { kind, locale, delimiter } = migrationTemplateOptions.parse(input);
  return "\uFEFF" + fieldsFor(kind).map(field => `"${HEADERS[locale][field].replace(/"/g, '""')}"`).join(delimiter) + "\r\n";
}
