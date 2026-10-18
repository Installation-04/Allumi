-- Fixtures of the database integration tests: two companies, four users, a chart of accounts, taxes.
-- Fictitious data only. Loaded as the owner by seedWorld() in world.ts; ids are fixed so tests can name them.
SET client_min_messages = warning;

INSERT INTO app_user (id, email, display_name, is_instance_admin, updated_at) VALUES
 ('00000000-0000-7000-8000-000000000001', 'proprio@exemple.test', 'Proprio A', true, now()),
 ('00000000-0000-7000-8000-000000000002', 'proprio-b@exemple.test', 'Proprio B', false, now()),
 ('00000000-0000-7000-8000-000000000003', 'lecture@exemple.test', 'Lecture A', false, now()),
 ('00000000-0000-7000-8000-000000000004', 'comptable@exemple.test', 'Comptable A', false, now());
INSERT INTO user_credential (user_id, password_hash, password_changed_at, updated_at)
SELECT id, 'argon2-placeholder', now(), now() FROM app_user;

INSERT INTO company (id, name, updated_at) VALUES
 ('00000000-0000-7000-8000-00000000000a', 'Atelier Exemple inc.', now()),
 ('00000000-0000-7000-8000-00000000000b', 'Autre Exemple inc.', now());

INSERT INTO membership (id, company_id, user_id, role, updated_at) VALUES
 (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-000000000001', 'OWNER', now()),
 (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-000000000003', 'READ_ONLY', now()),
 (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-000000000004', 'ACCOUNTANT', now()),
 (gen_random_uuid(), '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-000000000002', 'OWNER', now());

INSERT INTO fiscal_year (id, company_id, start_date, end_date) VALUES
 ('00000000-0000-7000-8000-0000000000fa', '00000000-0000-7000-8000-00000000000a', '2026-01-01', '2026-12-31'),
 ('00000000-0000-7000-8000-0000000000fb', '00000000-0000-7000-8000-00000000000b', '2026-01-01', '2026-12-31');

INSERT INTO fiscal_period (id, company_id, fiscal_year_id, period_number, start_date, end_date)
SELECT gen_random_uuid(), c.company_id, c.fy, m, make_date(2026, m, 1), (make_date(2026, m, 1) + interval '1 month - 1 day')::date
  FROM (VALUES ('00000000-0000-7000-8000-00000000000a'::uuid, '00000000-0000-7000-8000-0000000000fa'::uuid),
               ('00000000-0000-7000-8000-00000000000b'::uuid, '00000000-0000-7000-8000-0000000000fb'::uuid)) c(company_id, fy),
       generate_series(1, 12) m;

INSERT INTO account (id, company_id, code, name_fr, name_en, type, subtype, system_key, updated_at) VALUES
 ('00000000-0000-7000-8000-00000000a100', '00000000-0000-7000-8000-00000000000a', '1000', 'Banque', 'Bank', 'ASSET', 'BANK', NULL, now()),
 ('00000000-0000-7000-8000-00000000a105', '00000000-0000-7000-8000-00000000000a', '1050', 'Fonds non déposés', 'Undeposited funds', 'ASSET', 'CURRENT_ASSET', 'UNDEPOSITED_FUNDS', now()),
 ('00000000-0000-7000-8000-00000000a110', '00000000-0000-7000-8000-00000000000a', '1100', 'Comptes clients', 'Accounts receivable', 'ASSET', 'ACCOUNTS_RECEIVABLE', 'ACCOUNTS_RECEIVABLE', now()),
 ('00000000-0000-7000-8000-00000000a120', '00000000-0000-7000-8000-00000000000a', '1200', 'TPS à recevoir', 'GST receivable', 'ASSET', 'SALES_TAX', NULL, now()),
 ('00000000-0000-7000-8000-00000000a125', '00000000-0000-7000-8000-00000000000a', '1205', 'TVQ à recevoir', 'QST receivable', 'ASSET', 'SALES_TAX', NULL, now()),
 ('00000000-0000-7000-8000-00000000a200', '00000000-0000-7000-8000-00000000000a', '2000', 'Comptes fournisseurs', 'Accounts payable', 'LIABILITY', 'ACCOUNTS_PAYABLE', 'ACCOUNTS_PAYABLE', now()),
 ('00000000-0000-7000-8000-00000000a210', '00000000-0000-7000-8000-00000000000a', '2100', 'TPS à payer', 'GST payable', 'LIABILITY', 'SALES_TAX', NULL, now()),
 ('00000000-0000-7000-8000-00000000a215', '00000000-0000-7000-8000-00000000000a', '2105', 'TVQ à payer', 'QST payable', 'LIABILITY', 'SALES_TAX', NULL, now()),
 ('00000000-0000-7000-8000-00000000a300', '00000000-0000-7000-8000-00000000000a', '3000', 'Capital', 'Capital', 'EQUITY', 'EQUITY', NULL, now()),
 ('00000000-0000-7000-8000-00000000a400', '00000000-0000-7000-8000-00000000000a', '4000', 'Ventes', 'Sales', 'REVENUE', 'OPERATING_REVENUE', NULL, now()),
 ('00000000-0000-7000-8000-00000000a500', '00000000-0000-7000-8000-00000000000a', '5000', 'Frais généraux', 'General expenses', 'EXPENSE', 'OPERATING_EXPENSE', NULL, now()),
 ('00000000-0000-7000-8000-00000000b100', '00000000-0000-7000-8000-00000000000b', '1000', 'Banque B', 'Bank B', 'ASSET', 'BANK', NULL, now());

INSERT INTO contact (id, company_id, is_customer, is_supplier, display_name, updated_at) VALUES
 ('00000000-0000-7000-8000-00000000c001', '00000000-0000-7000-8000-00000000000a', true, false, 'Client Fictif', now()),
 ('00000000-0000-7000-8000-00000000c002', '00000000-0000-7000-8000-00000000000a', true, false, 'Autre Client', now()),
 ('00000000-0000-7000-8000-00000000c003', '00000000-0000-7000-8000-00000000000a', false, true, 'Fournisseur Fictif', now());

INSERT INTO tax (id, company_id, code, name_fr, name_en, payable_account_id, recoverable_account_id) VALUES
 ('00000000-0000-7000-8000-00000000d001', '00000000-0000-7000-8000-00000000000a', 'TPS', 'TPS', 'GST',
  '00000000-0000-7000-8000-00000000a210', '00000000-0000-7000-8000-00000000a120'),
 ('00000000-0000-7000-8000-00000000d002', '00000000-0000-7000-8000-00000000000a', 'TVQ', 'TVQ', 'QST',
  '00000000-0000-7000-8000-00000000a215', '00000000-0000-7000-8000-00000000a125');
INSERT INTO tax_rate (id, company_id, tax_id, rate, effective_from) VALUES
 (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000d001', 0.05, '2008-01-01'),
 (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000d002', 0.09975, '2013-01-01');
BEGIN;
INSERT INTO tax_code (id, company_id, code, name_fr, name_en, treatment) VALUES
 ('00000000-0000-7000-8000-00000000e001', '00000000-0000-7000-8000-00000000000a', 'TPS+TVQ', 'TPS et TVQ', 'GST and QST', 'STANDARD'),
 ('00000000-0000-7000-8000-00000000e002', '00000000-0000-7000-8000-00000000000a', 'EXONERE', 'Exonéré', 'Exempt', 'EXEMPT');
INSERT INTO tax_code_component (id, company_id, tax_code_id, tax_id, position) VALUES
 (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000e001', '00000000-0000-7000-8000-00000000d001', 1),
 (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000e001', '00000000-0000-7000-8000-00000000d002', 2);
COMMIT;

INSERT INTO invitation (id, company_id, email, role, token_hash, expires_at, created_by_id) VALUES
 (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', 'invite@exemple.test', 'ACCOUNTANT',
  repeat('ab', 32), now() + interval '7 days', '00000000-0000-7000-8000-000000000001');

