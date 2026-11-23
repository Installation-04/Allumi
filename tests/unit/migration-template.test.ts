import { it, expect } from "vitest";
import { migrationCsvTemplate, MIGRATION_KINDS, fieldsFor, suggestMapping, prepareMigration, readMigrationRecords, type MigrationField } from "@/modules/migration/client";

const cases = MIGRATION_KINDS.flatMap(kind => (["fr-CA", "en"] as const).flatMap(locale => ([",", ";", "\t"] as const).map(delimiter => ({ kind, locale, delimiter }))));
it.each(cases)("maps and imports a filled $kind template in $locale with delimiter '$delimiter'", options => {
  const csv = migrationCsvTemplate(options), records = readMigrationRecords(csv, options.delimiter);
  expect(csv.startsWith("\uFEFF")).toBe(true); expect(csv.endsWith("\r\n")).toBe(true);
  expect(records).toHaveLength(1);
  const mapping = suggestMapping(records[0]!.cells, options.kind), fields = fieldsFor(options.kind);
  expect(Object.keys(mapping).sort()).toEqual([...fields].sort());
  const spec = { source: options.locale === "en" ? "ONLINE" : "DESKTOP", kind: options.kind, delimiter: options.delimiter, format: options.locale, headerRecord: 1, mapping, defaultLocale: "en", skipExisting: false, cutoverDate: "2026-01-31" };
  // These files cannot import demonstration records: there are no source rows until the user adds them.
  expect(() => prepareMigration(csv, spec)).toThrow("empty");
  const decimal = options.locale === "en" ? "." : ",";
  const values: Partial<Record<MigrationField, string>> = { name: "Template Example", code: "9001", email: "sample@example.test", country: "CA", province: "QC", language: "en", terms: "30", price: `12${decimal}345678`, incomeAccount: "4000", expenseAccount: "5000", taxCode: "TPS+TVQ", accountType: "Bank", accountSubtype: "BANK", itemType: "Service", currency: "CAD" };
  const rows = options.kind === "BALANCES" ? [{ ...values, code: "1000", debit: `12${decimal}34`, credit: "0" }, { ...values, code: "3000", debit: "0", credit: `12${decimal}34` }] : [values];
  const filled = csv + rows.map(row => fields.map(field => `"${(row[field] ?? "").replace(/"/g, '""')}"`).join(options.delimiter)).join("\r\n") + "\r\n";
  const prepared = prepareMigration(filled, spec);
  expect(prepared.ignored).toEqual([]); expect(prepared.rows).toHaveLength(rows.length);
  if (options.kind === "ITEMS") expect(prepared.rows[0]).toMatchObject({ data: { unitPrice: "12.345678" }, refs: { income: "4000", expense: "5000", tax: "TPS+TVQ" } });
  if (options.kind === "BALANCES") expect(prepared.rows.map(row => row.data)).toEqual([{ code: "1000", debitCents: "1234", creditCents: "0" }, { code: "3000", debitCents: "0", creditCents: "1234" }]);
});
it("rejects unknown kinds, languages, delimiters and unexpected options", () => {
  for (const patch of [{ kind: "HISTORY" }, { locale: "fr" }, { delimiter: "|" }, { filename: "../private" }]) {
    expect(() => migrationCsvTemplate({ kind: "CUSTOMERS", locale: "en", delimiter: ",", ...patch })).toThrow();
  }
});
