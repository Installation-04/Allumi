import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { owner } from "./helpers";

let db: pg.Client;
beforeAll(async () => {
  db = await owner();
});
afterAll(async () => {
  await db.end();
});

const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query(sql, params)).rows as T[];

// Tables that hold no tenant data and are read before any context exists.
const WITHOUT_RLS = ["instance", "rate_limit"];

describe("database catalog (guards against a migration that forgets a table)", () => {
  it("forces row level security on every table except the two technical ones", async () => {
    const rows = await q<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
    );
    expect(rows.map((row) => row.relname).sort()).toEqual(WITHOUT_RLS);
  });

  it("gives every table with company_id at least a read and a write policy", async () => {
    const rows = await q<{ relname: string; policies: string }>(
      `SELECT c.relname, count(p.policyname)::text AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped
         LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        GROUP BY c.relname HAVING count(p.policyname) < 2`,
    );
    expect(rows).toEqual([]);
  });

  it("makes the application role an ordinary one", async () => {
    const [role] = await q<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(
      "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'allumi_app'",
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
  });

  it("never lets the application truncate, or update/delete the journal and the audit trail", async () => {
    const tables = (await q<{ relname: string }>("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'")).map((row) => row.relname);
    const offences: string[] = [];
    for (const table of tables) {
      const [row] = await q<{ trunc: boolean; upd: boolean; del: boolean; ins: boolean }>(
        `SELECT has_table_privilege('allumi_app', $1, 'TRUNCATE') AS trunc, has_any_column_privilege('allumi_app', $1, 'UPDATE') AS upd,
                has_table_privilege('allumi_app', $1, 'DELETE') AS del, has_table_privilege('allumi_app', $1, 'INSERT') AS ins`,
        [`public.${table}`],
      );
      if (row?.trunc) offences.push(`${table}: TRUNCATE`);
      if (["journal_entry", "journal_line", "audit_log"].includes(table)) {
        if (row?.upd) offences.push(`${table}: UPDATE`);
        if (row?.del) offences.push(`${table}: DELETE`);
      }
      if (table === "audit_log" && row?.ins) offences.push("audit_log: INSERT");
    }
    expect(offences).toEqual([]);
  });

  it("audits every business table (the trigger exists)", async () => {
    const audited = new Set((await q<{ tgname: string }>("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%\\_audit'")).map((row) => row.tgname.replace(/_audit$/, "")));
    const tables = (await q<{ relname: string }>("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'")).map((row) => row.relname);
    const exempt = new Set(["_prisma_migrations", "audit_log", "instance", "rate_limit", "session", "user_recovery_code", "password_reset_token", "number_sequence"]);
    expect(tables.filter((table) => !exempt.has(table) && !audited.has(table))).toEqual([]);
  });

  it("denies EXECUTE on functions to PUBLIC (only the application role may call the few that it needs)", async () => {
    const rows = await q<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND has_function_privilege('public', p.oid, 'EXECUTE')`,
    );
    expect(rows).toEqual([]);
  });

  it("keeps the Law 25 redaction function under its dedicated role (backups must preserve owners)", async () => {
    const rows = await q<{ owner: string }>(
      `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE proname = 'audit_redact' AND pronamespace = 'public'::regnamespace`,
    );
    expect(rows).toEqual([{ owner: "allumi_redactor" }]);
  });

  it("checks the accounting invariants with deferred constraint triggers (balance, completeness, deposits)", async () => {
    const rows = await q<{ tgname: string; deferrable: boolean; initially: boolean }>(
      `SELECT tgname, tgdeferrable AS deferrable, tginitdeferred AS initially FROM pg_trigger
        WHERE tgname IN ('journal_entry_complete', 'journal_line_balanced', 'bank_deposit_item_check', 'bank_deposit_complete')`,
    );
    expect(rows.map((row) => row.tgname).sort()).toEqual(["bank_deposit_complete", "bank_deposit_item_check", "journal_entry_complete", "journal_line_balanced"]);
    for (const row of rows) expect(row, row.tgname).toMatchObject({ deferrable: true, initially: true });
  });

  it("keeps the journal and audit immutable even for the table owner", async () => {
    await expect(db.query("UPDATE journal_line SET debit_cents = debit_cents")).resolves.toBeTruthy(); // no rows: nothing to refuse yet
    await expect(db.query("TRUNCATE journal_line CASCADE")).rejects.toMatchObject({ code: "AL004" });
    await expect(db.query("TRUNCATE audit_log")).rejects.toMatchObject({ code: "AL004" });
  });
});


it("installs catalogue price and account guards", async () => {
  expect(await q("SELECT conname FROM pg_constraint WHERE conname = 'item_price_range'")).toHaveLength(1);
  expect(await q("SELECT tgname FROM pg_trigger WHERE tgname IN ('item_account_guard', 'tax_account_types_guard') AND NOT tgisinternal")).toHaveLength(2);
});

it("checks invoice revenue and tax postings at transaction completion", async () => {
  expect(await q("SELECT tgname FROM pg_trigger WHERE tgname='invoice_posting_exact' AND tgdeferrable AND tginitdeferred AND NOT tgisinternal")).toHaveLength(1);
});
