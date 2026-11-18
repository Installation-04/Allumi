import { it, expect } from "vitest";
import fc from "fast-check";
import { readMigrationCsv, decodeMigrationCsv, MAX_MIGRATION_BYTES, MigrationCsvError, prepareMigration, suggestMapping, type MigrationSpec } from "@/modules/migration/client";
const base: MigrationSpec = { source: "ONLINE", kind: "CUSTOMERS", delimiter: ",", format: "en", headerRecord: 1, mapping: { name: 0, email: 1 }, defaultLocale: "fr_CA", skipExisting: false, cutoverDate: "" };
const error = (run: () => unknown, code: string) => { try { run(); throw new Error("unexpected success"); } catch (e) { expect(e).toBeInstanceOf(MigrationCsvError); expect((e as MigrationCsvError).code).toBe(code); } };
it("reads quoted cells, newlines, escaped quotes and explicit non-empty header position", () => {
  const text = 'Company\r\n\r\nCustomer list\r\nName,Email\r\n"Example, ""North""\nBranch",a@example.test\r\n';
  const r = prepareMigration(text, { ...base, headerRecord: 3 });
  expect(r.rows[0]?.name).toBe('Example, "North"\nBranch'); expect(r.rows[0]?.row).toBe(5);
});
it("maps official-style customer/vendor headers and refuses ambiguous suggestions", () => {
  const headers = ["Customer", "Company", "Email", "Phone", "Bill Street", "Bill City", "Bill State", "Bill Zip", "Bill Country", "Terms"];
  const mapping = suggestMapping(headers, "CUSTOMERS"); expect(mapping).toMatchObject({ name: 0, legalName: 1, province: 6 });
  const r = prepareMigration(headers.join(',') + '\nExample,Example Inc.,a@example.test,555,1 Road,Montréal,Quebec,H1A 1A1,Canada,Net 45', { ...base, mapping });
  expect(r.rows[0]).toMatchObject({ kind: "CUSTOMERS", data: { province: "QC", country: "CA", paymentTermsDays: 45, locale: "fr_CA" } });
  expect(suggestMapping(["Name", "Customer", "Email", "Email"], "CUSTOMERS")).not.toHaveProperty("name");
  expect(suggestMapping(["Name", "Email", "Email"], "CUSTOMERS")).not.toHaveProperty("email");
});
it("keeps unused balances visible as ignored columns and preserves formula-looking names as literal text", () => {
  const r = prepareMigration('Name,Email,Balance\n=1+1,a@example.test,99.00', base);
  expect(r.rows[0]?.name).toBe('=1+1'); expect(r.ignored).toEqual([{ column: 2, header: "Balance" }]);
});
it("rejects duplicate normalized identities before preparing any rows", () => { error(() => prepareMigration('Name,Email\nACME  Inc.,a@example.test\nacme inc.,b@example.test', base), 'duplicate'); });
it("refuses malformed quotes, ragged rows, binary controls, invalid UTF-8 and bounded uploads", () => {
  for (const text of ['Name,Email\n"bad"junk,a@example.test', 'Name,Email\n"unclosed,a@example.test', 'Name,Email\na\u0000,b@example.test']) error(() => readMigrationCsv(text, ','), 'syntax');
  error(() => readMigrationCsv('Name,Email\na,b,c', ','), 'columns');
  error(() => decodeMigrationCsv(new Uint8Array([0xc3, 0x28])), 'encoding');
  error(() => decodeMigrationCsv(new Uint8Array(MAX_MIGRATION_BYTES + 1)), 'size');
  error(() => readMigrationCsv('Name,Email\n' + Array.from({ length: 1001 }, (_, i) => `Name${i},a@example.test`).join('\n'), ','), 'rows');
});
it("requires explicit currency/type columns when the source exposes them and refuses non-CAD/inventory", () => {
  error(() => prepareMigration('Name,Email,Currency\nName,a@example.test,USD', base), 'mapping');
  error(() => prepareMigration('Name,Email,Currency\nName,a@example.test,USD', { ...base, mapping: { ...base.mapping, currency: 2 } }), 'currency');
  const item = { ...base, kind: 'ITEMS', mapping: { name: 0, price: 1, itemType: 2 } };
  error(() => prepareMigration('Name,Price,Type\nPart,20.00,Inventory', item), 'inventory');
});
it("imports French Desktop service prices with exact six-decimal strings and required reference codes", () => {
  const r = prepareMigration('Nom;Prix;Type;Compte de revenus;Code de taxe\nService;123,456789;Service;4000;TPS+TVQ', { ...base, source: 'DESKTOP', kind: 'ITEMS', delimiter: ';', format: 'fr-CA', mapping: { name: 0, price: 1, itemType: 2, incomeAccount: 3, taxCode: 4 } });
  expect(r.rows[0]).toMatchObject({ kind: 'ITEMS', data: { unitPrice: '123.456789' }, refs: { income: '4000', tax: 'TPS+TVQ' } });
  for (const price of ['-1,00', '1.00', '1 000,00', '1,1234567', '$1,00']) error(() => prepareMigration(`Name;Price\nService;${price}`, { ...base, kind: 'ITEMS', delimiter: ';', format: 'fr-CA', mapping: { name: 0, price: 1 } }), 'invalid');
});
it("classifies account types explicitly, with no guessed balance or hierarchy", () => {
  const r = prepareMigration('Name,Code,Type\nOperating,9001,Bank\nRevenue,9002,Income', { ...base, kind: 'ACCOUNTS', mapping: { name: 0, code: 1, accountType: 2 } });
  expect(r.rows[0]).toMatchObject({ kind: 'ACCOUNTS', data: { type: 'ASSET', subtype: 'BANK', parentId: null } });
  expect(r.rows[1]).toMatchObject({ data: { type: 'REVENUE', subtype: 'OPERATING_REVENUE' } });
  error(() => prepareMigration('Name,Code,Type\nUnknown,9000,Mystery', { ...base, kind: 'ACCOUNTS', mapping: { name: 0, code: 1, accountType: 2 } }), 'invalid');
});
it("prepares balanced target cents exactly and permits explicit zero target accounts", () => {
  const spec = { ...base, kind: 'BALANCES', mapping: { code: 0, debit: 1, credit: 2 }, cutoverDate: '2026-01-31' };
  fc.assert(fc.property(fc.bigInt({ min: 0n, max: 99999999999999n }), cents => {
    const value = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
    const r = prepareMigration(`Code,Debit,Credit\n1000,${value},0\n3000,0,${value}\n4000,0,0`, spec);
    expect(r.rows[0]).toMatchObject({ kind: 'BALANCES', data: { debitCents: cents.toString(), creditCents: '0' } });
  }));
  error(() => prepareMigration('Code,Debit,Credit\n1000,10,0\n3000,0,9', spec), 'invalid');
  error(() => prepareMigration('Code,Debit,Credit\n1000,10,10', spec), 'invalid');
});
it("rejects invalid mappings, email and source editions without coercing them", () => {
  const text = 'Name,Email\nName,invalid';
  error(() => prepareMigration(text, base), 'invalid');
  error(() => prepareMigration(text, { ...base, mapping: { name: 99 } }), 'mapping');
  error(() => prepareMigration(text, { ...base, source: 'OTHER' }), 'mapping');
});
