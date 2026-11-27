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

it("guards mileage precision, text, dates, revisions and Accounting access with audit",async()=>{
 expect(await q("SELECT conname FROM pg_constraint WHERE conname IN ('mileage_trip_date','mileage_trip_usage','mileage_trip_distance','mileage_trip_revision','mileage_trip_text','mileage_trip_business_purpose')")).toHaveLength(6);
 expect(await q("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('mileage_trip_guard','mileage_trip_audit')")).toHaveLength(2);
 const policies=await q<{cmd:string;qual:string|null;with_check:string|null}>("SELECT cmd,qual,with_check FROM pg_policies WHERE tablename='mileage_trip' AND permissive='RESTRICTIVE'");
 expect(policies.map(p=>p.cmd).sort()).toEqual(['DELETE','INSERT','SELECT','UPDATE']);for(const p of policies)expect(`${p.qual}${p.with_check}`).toContain('accounting');
 const functions=await q<{name:string;definer:boolean;public_execute:boolean}>("SELECT proname AS name,prosecdef AS definer,has_function_privilege('public',oid,'EXECUTE') AS public_execute FROM pg_proc WHERE proname IN ('mileage_trip_guard','mileage_text_valid')");
 expect(functions).toHaveLength(2);for(const f of functions){expect(f.definer).toBe(false);expect(f.public_execute).toBe(false);}
 expect((await q("SELECT has_table_privilege('allumi_app','mileage_trip','TRUNCATE') AS ok"))[0]).toEqual({ok:false});
});

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

  it("keeps the credentials of integrations for the owner alone, and never deletes a connection", async () => {
    const policies = await q<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
      "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integration_credential' AND permissive = 'PERMISSIVE'",
    );
    expect(policies.map((row) => row.cmd).sort()).toEqual(["INSERT", "SELECT", "UPDATE"]);
    for (const row of policies) expect(`${row.qual ?? ""}${row.with_check ?? ""}`, row.policyname).toContain("OWNER");
    for (const table of ["integration_connection", "integration_credential"]) {
      const [row] = await q<{ del: boolean; trunc: boolean }>("SELECT has_table_privilege('allumi_app', $1, 'DELETE') AS del, has_table_privilege('allumi_app', $1, 'TRUNCATE') AS trunc", [`public.${table}`]);
      expect(row, table).toEqual({ del: false, trunc: false });
    }
    // the secret itself is outside every audit trigger's payload: the trigger names it as a secret column
    const [trigger] = await q<{ def: string }>("SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'integration_credential_audit'");
    expect(trigger?.def).toContain("credentials_enc");
  });

  it("lets only the owner create and advance payment links, and never deletes a link or an online payment", async () => {
    for (const table of ["payment_link", "online_payment"]) {
      const policies = await q<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
        "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 AND permissive = 'PERMISSIVE'", [table],
      );
      expect(policies.map((row) => row.cmd).sort(), table).toEqual(table === "payment_link" ? ["INSERT", "SELECT", "UPDATE"] : ["INSERT", "SELECT"]);
      for (const row of policies.filter((policy) => policy.cmd !== "SELECT")) expect(`${row.qual ?? ""}${row.with_check ?? ""}`, `${table}.${row.policyname}`).toContain("OWNER");
      const [grants] = await q<{ del: boolean; trunc: boolean; upd: boolean }>("SELECT has_table_privilege('allumi_app', $1, 'DELETE') AS del, has_table_privilege('allumi_app', $1, 'TRUNCATE') AS trunc, has_table_privilege('allumi_app', $1, 'UPDATE') AS upd", [`public.${table}`]);
      expect(grants, table).toMatchObject({ del: false, trunc: false });
    }
    // an online payment is never updated, not even column by column; a link changes its state, not its amount or its invoice
    const columns = await q<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.column_privileges
        WHERE grantee = 'allumi_app' AND privilege_type = 'UPDATE' AND table_name IN ('payment_link', 'online_payment')`,
    );
    expect(columns.filter((row) => row.table_name === "online_payment")).toEqual([]);
    expect(columns.filter((row) => row.table_name === "payment_link").map((row) => row.column_name).sort())
      .toEqual(["external_id", "external_price_id", "last_error", "review_reason", "status", "updated_at", "url"]);
  });

  it("lets the application add and remove matches but never edit one, and change only the status of a statement line", async () => {
    const [match] = await q<{ ins: boolean; del: boolean; upd: boolean; trunc: boolean }>(
      "SELECT has_table_privilege('allumi_app', 'public.bank_match', 'INSERT') AS ins, has_table_privilege('allumi_app', 'public.bank_match', 'DELETE') AS del, has_table_privilege('allumi_app', 'public.bank_match', 'UPDATE') AS upd, has_table_privilege('allumi_app', 'public.bank_match', 'TRUNCATE') AS trunc",
    );
    expect(match).toEqual({ ins: true, del: true, upd: false, trunc: false });
    const columns = await q<{ column_name: string }>("SELECT column_name FROM information_schema.column_privileges WHERE grantee = 'allumi_app' AND privilege_type = 'UPDATE' AND table_name = 'bank_transaction'");
    expect(columns.map((row) => row.column_name).sort()).toEqual(["status", "updated_at"]);
    // removing a match is refused while a reconciliation counts its line
    const triggers = await q<{ def: string }>("SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'bank_match_reconciled' AND NOT tgisinternal");
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.def).toContain("BEFORE DELETE ON public.bank_match");
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

it("guards cumulative linked credit limits and exact credit postings", async () => {
  expect(await q("SELECT tgname FROM pg_trigger WHERE tgname='credit_note_limits' AND NOT tgisinternal")).toHaveLength(1);
  const rows=await q<{ definition:string }>("SELECT pg_get_functiondef('invoice_posting_exact()'::regprocedure) AS definition");
  expect(rows[0]?.definition).toContain("CREDIT_NOTE");
});

describe("modular access and server delegation catalog", () => {
  it("keeps module permissions validated and server grants outside profile privileges", async () => {
    const columns = await q<{ table_name: string }>("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='module_access' ORDER BY table_name");
    expect(columns.map(r => r.table_name)).toEqual(["invitation", "membership"]);
    expect((await q<{ allowed: boolean }>("SELECT has_column_privilege('allumi_app','app_user','can_manage_server','UPDATE') AS allowed"))[0]?.allowed).toBe(false);
    expect((await q<{ ok: boolean }>("SELECT valid_module_access('{\"contacts\":\"write\"}'::jsonb) AND NOT valid_module_access('{\"server\":\"write\"}'::jsonb) AS ok"))[0]?.ok).toBe(true);
  });
  it("keeps restrictive module policies on tenant business data", async () => {
    const rows=await q<{ tablename: string }>("SELECT tablename FROM pg_policies WHERE policyname='module_read' AND permissive='RESTRICTIVE'");
    expect(rows.map(r=>r.tablename)).toEqual(expect.arrayContaining(["contact","item","sales_document","journal_entry","account","tax","audit_log","integration_connection","online_payment"]));
    const business = await q<{ table_name: string }>("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id' AND table_name NOT IN ('membership','invitation')");
    expect(business.filter(t=>!rows.some(r=>r.tablename===t.table_name))).toEqual([]);
  });
});

it("guards supplier credit limits, source taxes and exact deferred postings", async () => {
 expect(await q("SELECT tgname FROM pg_trigger WHERE tgname='supplier_credit_limits' AND NOT tgisinternal")).toHaveLength(1);
 expect(await q("SELECT tgname FROM pg_trigger WHERE tgname='supplier_credit_posting_exact' AND tgdeferrable AND tginitdeferred AND NOT tgisinternal")).toHaveLength(1);
 expect((await q<{ok:boolean}>("SELECT has_function_privilege('allumi_app','purchase_document_taxes_are_exact(purchase_document)','EXECUTE') AS ok"))[0]?.ok).toBe(true);
});

it("checks paid expense postings exactly at transaction completion", async () => {
 expect(await q("SELECT tgname FROM pg_trigger WHERE tgname='paid_expense_posting_exact' AND tgdeferrable AND tginitdeferred AND NOT tgisinternal")).toHaveLength(1);
});

it("separates immutable attachment scopes and checks target scope in the database", async()=>{
 expect(await q("SELECT conname FROM pg_constraint WHERE conname='attachment_scope'")).toHaveLength(1);
 expect(await q("SELECT tgname FROM pg_trigger WHERE tgname='attachment_scope_guard' AND NOT tgisinternal")).toHaveLength(1);
 const rows=await q<{qual:string}>("SELECT qual FROM pg_policies WHERE tablename='attachment' AND policyname='module_read'");
 expect(rows[0]?.qual).toContain("scope");
});

it("preserves invoice email attempts and grants only outcome transitions",async()=>{
 const [grants]=await q<{del:boolean;trunc:boolean}>("SELECT has_table_privilege('allumi_app','invoice_email','DELETE') AS del, has_table_privilege('allumi_app','invoice_email','TRUNCATE') AS trunc");
 expect(grants).toEqual({del:false,trunc:false});
 const columns=await q<{column_name:string}>("SELECT column_name FROM information_schema.column_privileges WHERE grantee='allumi_app' AND table_name='invoice_email' AND privilege_type='UPDATE' ORDER BY column_name");
 expect(columns.map(c=>c.column_name)).toEqual(["completed_at","status"]);
 expect(await q("SELECT tgname FROM pg_trigger WHERE tgname='invoice_email_guard' AND NOT tgisinternal")).toHaveLength(1);
 expect(await q("SELECT conname FROM pg_constraint WHERE conname='invoice_email_purpose_check'")).toHaveLength(1);
 const reminderColumns=await q<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_name='invoice_email' AND column_name IN ('purpose','reminder_cents','reminder_date') ORDER BY column_name");
 expect(reminderColumns.map(c=>c.column_name)).toEqual(['purpose','reminder_cents','reminder_date']);
});

it("preserves estimate email attempts with tenant Sales policies, audit and outcome-only grants", async () => {
 const [grants] = await q<{ del: boolean; trunc: boolean }>("SELECT has_table_privilege('allumi_app','estimate_email','DELETE') AS del, has_table_privilege('allumi_app','estimate_email','TRUNCATE') AS trunc");
 expect(grants).toEqual({ del: false, trunc: false });
 const columns = await q<{ column_name: string }>("SELECT column_name FROM information_schema.column_privileges WHERE grantee='allumi_app' AND table_name='estimate_email' AND privilege_type='UPDATE' ORDER BY column_name");
 expect(columns.map(c => c.column_name)).toEqual(['completed_at','status']);
 expect(await q("SELECT tgname FROM pg_trigger WHERE tgname IN ('estimate_email_guard','estimate_email_audit') AND NOT tgisinternal")).toHaveLength(2);
 expect((await q<{qual:string}>("SELECT qual FROM pg_policies WHERE tablename='estimate_email' AND policyname='module_read' AND permissive='RESTRICTIVE'"))[0]?.qual).toContain('sales');
});

it("protects bank rule identity, revisions and audit history in the database", async()=>{
 const [grants]=await q<{del:boolean;trunc:boolean}>("SELECT has_table_privilege('allumi_app','bank_rule','DELETE') AS del,has_table_privilege('allumi_app','bank_rule','TRUNCATE') AS trunc");
 expect(grants).toEqual({del:false,trunc:false});
 const columns=await q<{column_name:string}>("SELECT column_name FROM information_schema.column_privileges WHERE grantee='allumi_app' AND table_name='bank_rule' AND privilege_type='UPDATE'");
 expect(columns.map(c=>c.column_name).filter(c=>['id','company_id','revision','created_at'].includes(c))).toEqual([]);
 expect(await q("SELECT tgname FROM pg_trigger WHERE tgname='bank_rule_guard' AND NOT tgisinternal")).toHaveLength(1);
});

it("keeps grouped deposits immutable and guards exact postings and bank links",async()=>{
 const columns=await q<{column_name:string}>("SELECT column_name FROM information_schema.column_privileges WHERE grantee='allumi_app' AND table_name='bank_deposit' AND privilege_type='UPDATE'");
 expect(columns.map(c=>c.column_name).sort()).toEqual(['status','updated_at','void_entry_id','void_reason','voided_at','voided_by_id']);
 const rows=await q<{tgname:string}>("SELECT tgname FROM pg_trigger WHERE tgname IN ('deposit_posting_exact','deposit_items_exact','deposit_bank_link','deposit_reconciled_link') AND NOT tgisinternal");
 expect(rows).toHaveLength(4);
});

it("requires current snapshots for payment cancellations", async () => {
  const [row] = await q<{ definition: string }>("SELECT pg_get_functiondef('payment_guard()'::regprocedure) AS definition");
  expect(row?.definition).toContain("payment cancellation requires read committed isolation");
  expect(row?.definition).toContain("payment_open_cents");
  expect(row?.definition).toContain("bank_deposit_item");
});

it("installs immediate customer application and cancellation guards on the intended events", async () => {
  const rows = await q<{ name: string; table_name: string; function_name: string; events: number; enabled: string; deferred: boolean }>(
    `SELECT t.tgname AS name, c.relname AS table_name, p.proname AS function_name,
            t.tgtype::integer AS events, t.tgenabled AS enabled, t.tgdeferrable AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND t.tgname IN ('customer_credit_application_guard', 'customer_payment_allocation_guard', 'customer_document_void_isolation')
      ORDER BY t.tgname`,
  );
  // pg_trigger bits: ROW=1, BEFORE=2, INSERT=4, UPDATE=16.
  expect(rows).toEqual([
    { name: "customer_credit_application_guard", table_name: "sales_credit_application", function_name: "customer_application_guard", events: 23, enabled: "O", deferred: false },
    { name: "customer_document_void_isolation", table_name: "sales_document", function_name: "customer_document_void_isolation", events: 19, enabled: "O", deferred: false },
    { name: "customer_payment_allocation_guard", table_name: "payment_allocation", function_name: "customer_application_guard", events: 23, enabled: "O", deferred: false },
  ]);
});

it("keeps customer guards under caller privileges with restricted function execution", async () => {
  const rows = await q<{ name: string; definer: boolean; config: string[]; public_execute: boolean }>(
    `SELECT p.proname AS name, p.prosecdef AS definer, p.proconfig AS config,
            has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.pronargs = 0
        AND p.proname IN ('customer_application_guard', 'customer_document_void_isolation')
      ORDER BY p.proname`,
  );
  expect(rows).toEqual([
    { name: "customer_application_guard", definer: false, config: ["search_path=public, pg_temp"], public_execute: false },
    { name: "customer_document_void_isolation", definer: false, config: ["search_path=public, pg_temp"], public_execute: false },
  ]);
});

it("installs immediate customer receipt guards on payments, allocations and offsets", async () => {
  const rows = await q<{ name: string; table_name: string; function_name: string; events: number; enabled: string; deferred: boolean }>(
    `SELECT t.tgname AS name, c.relname AS table_name, p.proname AS function_name,
            t.tgtype::integer AS events, t.tgenabled AS enabled, t.tgdeferrable AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND t.tgname IN ('customer_account_payment_guard', 'customer_account_allocation_guard', 'customer_account_offset_guard')
      ORDER BY t.tgname`,
  );
  // pg_trigger bits: ROW=1, BEFORE=2, INSERT=4, UPDATE=16.
  expect(rows).toEqual([
    { name: "customer_account_allocation_guard", table_name: "payment_allocation", function_name: "customer_receipt_movement_guard", events: 23, enabled: "O", deferred: false },
    { name: "customer_account_offset_guard", table_name: "payment_offset", function_name: "customer_receipt_movement_guard", events: 23, enabled: "O", deferred: false },
    { name: "customer_account_payment_guard", table_name: "payment", function_name: "customer_receipt_movement_guard", events: 23, enabled: "O", deferred: false },
  ]);
});

it("keeps customer receipt movement checks volatile under caller privileges", async () => {
  const rows = await q<{ definer: boolean; volatility: string; config: string[]; public_execute: boolean }>(
    `SELECT p.prosecdef AS definer, p.provolatile AS volatility, p.proconfig AS config,
            has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.pronargs = 0 AND p.proname = 'customer_receipt_movement_guard'`,
  );
  expect(rows).toEqual([
    { definer: false, volatility: "v", config: ["search_path=public, pg_temp"], public_execute: false },
  ]);
});

it("checks new customer refund postings after payment and journal line inserts", async () => {
  const rows = await q<{ name: string; table_name: string; function_name: string; events: number; enabled: string; constraint_trigger: boolean; deferred: boolean; initially_deferred: boolean }>(
    `SELECT t.tgname AS name, c.relname AS table_name, p.proname AS function_name,
            t.tgtype::integer AS events, t.tgenabled AS enabled, t.tgconstraint <> 0 AS constraint_trigger,
            t.tgdeferrable AS deferred, t.tginitdeferred AS initially_deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND t.tgname IN ('customer_refund_payment_exact', 'customer_refund_line_exact')
      ORDER BY t.tgname`,
  );
  // pg_trigger bits: ROW=1, INSERT=4; AFTER has neither BEFORE nor INSTEAD OF.
  expect(rows).toEqual([
    { name: "customer_refund_line_exact", table_name: "journal_line", function_name: "customer_refund_posting_exact", events: 5, enabled: "O", constraint_trigger: true, deferred: true, initially_deferred: true },
    { name: "customer_refund_payment_exact", table_name: "payment", function_name: "customer_refund_posting_exact", events: 5, enabled: "O", constraint_trigger: true, deferred: true, initially_deferred: true },
  ]);
});

it("keeps exact customer refund checks volatile under caller privileges", async () => {
  const rows = await q<{ definer: boolean; volatility: string; config: string[]; public_execute: boolean }>(
    `SELECT p.prosecdef AS definer, p.provolatile AS volatility, p.proconfig AS config,
            has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.pronargs = 0 AND p.proname = 'customer_refund_posting_exact'`,
  );
  expect(rows).toEqual([
    { definer: false, volatility: "v", config: ["search_path=public, pg_temp"], public_execute: false },
  ]);
});

it("guards commercial estimates with deferred totals, tenant Sales policies, immutable issued lines and a protected counter", async () => {
  const triggers = await q<{ tgname: string; deferred: boolean }>("SELECT tgname,tgdeferrable AS deferred FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('sales_estimate_totals','sales_estimate_line_totals','sales_estimate_guard','sales_estimate_line_guard','sales_estimate_counter_guard','estimate_invoice_contact_guard') ORDER BY tgname");
  expect(triggers).toHaveLength(6);
  expect(triggers.filter(t=>t.deferred).map(t=>t.tgname)).toEqual(['sales_estimate_line_totals','sales_estimate_totals']);
  for (const table of ['sales_estimate','sales_estimate_line','sales_estimate_counter']) {
    const policies = await q<{ qual: string }>("SELECT qual FROM pg_policies WHERE tablename=$1 AND policyname='module_read' AND permissive='RESTRICTIVE'",[table]);
    expect(policies[0]?.qual).toContain("sales");
  }
  expect((await q<{del:boolean}>("SELECT has_table_privilege('allumi_app','sales_estimate_counter','DELETE') AS del"))[0]?.del).toBe(false);
  expect((await q<{definer:boolean}>("SELECT prosecdef AS definer FROM pg_proc WHERE proname='sales_estimate_exact'"))[0]?.definer).toBe(false);
});

it("protects recurring plans and occurrences with Sales RLS, immutable history and deferred advancement",async()=>{
 const rows=await q<{tgname:string}>("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('sales_recurring_plan_guard','sales_recurring_occurrence_guard','sales_recurring_complete','recurring_invoice_contact_guard')");expect(rows).toHaveLength(4);
 expect(await q("SELECT tgname FROM pg_trigger WHERE tgname='sales_recurring_complete' AND tgdeferrable AND tginitdeferred")).toHaveLength(1);
 for(const table of ['sales_recurring_plan','sales_recurring_occurrence']){
  const [grants]=await q<{del:boolean;trunc:boolean}>("SELECT has_table_privilege('allumi_app',$1,'DELETE') AS del,has_table_privilege('allumi_app',$1,'TRUNCATE') AS trunc",[table]);expect(grants).toEqual({del:false,trunc:false});
  expect((await q<{qual:string}>("SELECT qual FROM pg_policies WHERE tablename=$1 AND policyname='module_read' AND permissive='RESTRICTIVE'",[table]))[0]?.qual).toContain('sales');
 }
});

it("installs immediate supplier application and posting/cancellation guards under caller privileges",async()=>{
 const triggers=await q<{name:string;table_name:string;function_name:string;events:number;enabled:string;deferred:boolean}>(`SELECT t.tgname AS name,c.relname AS table_name,p.proname AS function_name,t.tgtype::integer AS events,t.tgenabled AS enabled,t.tgdeferrable AS deferred FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname IN ('supplier_credit_application_guard','supplier_payment_allocation_guard','supplier_credit_00_isolation') ORDER BY t.tgname`);
 expect(triggers).toEqual([
  {name:"supplier_credit_00_isolation",table_name:"purchase_document",function_name:"supplier_document_isolation",events:19,enabled:"O",deferred:false},
  {name:"supplier_credit_application_guard",table_name:"purchase_credit_application",function_name:"supplier_application_guard",events:23,enabled:"O",deferred:false},
  {name:"supplier_payment_allocation_guard",table_name:"payment_allocation",function_name:"supplier_application_guard",events:23,enabled:"O",deferred:false},
 ]);
 const functions=await q<{name:string;definer:boolean;config:string[];public_execute:boolean}>(`SELECT p.proname AS name,p.prosecdef AS definer,p.proconfig AS config,has_function_privilege('public',p.oid,'EXECUTE') AS public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.pronargs=0 AND p.proname IN ('supplier_application_guard','supplier_document_isolation') ORDER BY p.proname`);
 expect(functions).toEqual([
  {name:"supplier_application_guard",definer:false,config:["search_path=public, pg_temp"],public_execute:false},
  {name:"supplier_document_isolation",definer:false,config:["search_path=public, pg_temp"],public_execute:false},
 ]);
});

it("isolates annual budgets with composite scope, audit, bounded cents and automatic revisions",async()=>{
 expect(await q("SELECT conname FROM pg_constraint WHERE conname IN ('budget_fiscal_year_fkey','budget_line_budget_fkey','budget_line_account_fkey','budget_line_amount','budget_revision','budget_name')")).toHaveLength(6);
 expect(await q("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('budget_guard','budget_line_guard','budget_line_revision','budget_audit','budget_line_audit','budget_account_guard')")).toHaveLength(6);
 for(const table of ['budget','budget_line']){
  expect((await q<{qual:string}>("SELECT qual FROM pg_policies WHERE tablename=$1 AND policyname='module_read' AND permissive='RESTRICTIVE'",[table]))[0]?.qual).toContain('accounting');
  expect((await q<{ok:boolean}>("SELECT has_table_privilege('allumi_app',$1,'TRUNCATE') AS ok",[table]))[0]?.ok).toBe(false);
 }
 expect((await q<{ok:boolean}>("SELECT has_table_privilege('allumi_app','budget','DELETE') AS ok"))[0]?.ok).toBe(false);
});
it("keeps saved forecast settings immutable, bounded, audited and gated by both modules",async()=>{
 expect(await q("SELECT conname FROM pg_constraint WHERE conname IN ('cash_forecast_preset_name','cash_forecast_preset_days','cash_forecast_preset_delays','cash_forecast_preset_company_id_name_key')")).toHaveLength(4);
 expect(await q("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('cash_forecast_preset_guard','cash_forecast_preset_audit')")).toHaveLength(2);
 const policies=await q<{cmd:string;qual:string|null;with_check:string|null}>("SELECT cmd,qual,with_check FROM pg_policies WHERE tablename='cash_forecast_preset' AND permissive='RESTRICTIVE'");
 expect(policies.map(p=>p.cmd).sort()).toEqual(['DELETE','INSERT','SELECT']);
 for(const p of policies){expect(`${p.qual}${p.with_check}`).toContain('accounting');expect(`${p.qual}${p.with_check}`).toContain('sales');}
 expect((await q("SELECT has_table_privilege('allumi_app','cash_forecast_preset','UPDATE') AS upd,has_table_privilege('allumi_app','cash_forecast_preset','TRUNCATE') AS trunc"))[0]).toEqual({upd:false,trunc:false});
 const [guard]=await q<{definer:boolean;public_execute:boolean;definition:string}>("SELECT prosecdef AS definer,has_function_privilege('public',oid,'EXECUTE') AS public_execute,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname='cash_forecast_preset_guard'");
 expect(guard?.definer).toBe(false);expect(guard?.public_execute).toBe(false);expect(guard?.definition).toContain('pg_advisory_xact_lock');expect(guard?.definition).toContain('read committed');
});
it('guards monthly targets with same-year scope, bounded sums, revision/audit and restricted execution',async()=>{
 expect(await q("SELECT conname FROM pg_constraint WHERE conname IN ('budget_monthly_target_line_fkey','budget_monthly_target_period_fkey','budget_monthly_target_amount','budget_line_company_id_id_key')")).toHaveLength(4);
 expect(await q("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('budget_monthly_target_guard','budget_line_monthly_guard','budget_monthly_target_revision','budget_monthly_target_audit')")).toHaveLength(4);
 expect((await q<{qual:string}>("SELECT qual FROM pg_policies WHERE tablename='budget_monthly_target' AND policyname='module_read' AND permissive='RESTRICTIVE'"))[0]?.qual).toContain('accounting');
 const functions=await q<{definer:boolean;public_execute:boolean;definition:string}>("SELECT prosecdef AS definer,has_function_privilege('public',oid,'EXECUTE') AS public_execute,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname IN ('budget_monthly_target_guard','budget_line_monthly_guard')");
 expect(functions).toHaveLength(2);for(const f of functions){expect(f.definer).toBe(false);expect(f.public_execute).toBe(false);expect(f.definition).toContain('read committed');expect(f.definition).toContain('FOR UPDATE');}
 expect((await q<{ok:boolean}>("SELECT has_table_privilege('allumi_app','budget_monthly_target','TRUNCATE') AS ok"))[0]?.ok).toBe(false);
});

it("keeps migration batches tenant-scoped, immutable and linked to one cutover entry", async () => {
 const [table] = await q<{ force: boolean }>("SELECT relforcerowsecurity AS force FROM pg_class WHERE relname='migration_batch'");expect(table?.force).toBe(true);
 const constraints = await q<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='migration_batch'::regclass");
 expect(constraints.some(c => /company_id, journal_entry_id/.test(c.def) && /journal_entry/.test(c.def))).toBe(true);
 expect(constraints.some(c => /created_count \+ skipped_count/.test(c.def))).toBe(true);
 const indexes = await q<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE tablename='migration_batch'");expect(indexes.some(i => /UNIQUE/.test(i.indexdef) && /BALANCES/.test(i.indexdef))).toBe(true);
 const [grant] = await q<{ upd: boolean; del: boolean; trunc: boolean }>("SELECT has_table_privilege('allumi_app','migration_batch','UPDATE') AS upd,has_table_privilege('allumi_app','migration_batch','DELETE') AS del,has_table_privilege('allumi_app','migration_batch','TRUNCATE') AS trunc");expect(grant).toEqual({upd:false,del:false,trunc:false});
 const [guard] = await q<{ def: string }>("SELECT pg_get_functiondef('migration_batch_guard()'::regprocedure) AS def");expect(guard?.def).toMatch(/app_current_user_id/);expect(guard?.def).toMatch(/read committed/);expect(guard?.def).toMatch(/immutable/);
});

it("protects client document capabilities, signed metadata and external audit with forced Sales RLS",async()=>{
 for(const table of ['contract_template','client_document','client_document_delivery']){
  const [row]=await q<{relrowsecurity:boolean;relforcerowsecurity:boolean}>("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",[table]);expect(row).toEqual({relrowsecurity:true,relforcerowsecurity:true});
  const policies=await q<{qual:string|null;with_check:string|null}>("SELECT qual,with_check FROM pg_policies WHERE tablename=$1 AND permissive='RESTRICTIVE'",[table]);expect(policies).toHaveLength(4);for(const p of policies)expect(`${p.qual}${p.with_check}`).toContain('sales');
  expect((await q<{ok:boolean}>("SELECT has_table_privilege('allumi_app',$1,'TRUNCATE') AS ok",[table]))[0]?.ok).toBe(false);
 }
 for(const column of ['first_viewed_at','signed_at','signer_name','signer_email','consent_text'])expect((await q<{ok:boolean}>("SELECT has_column_privilege('allumi_app','client_document',$1,'UPDATE') AS ok",[column]))[0]?.ok).toBe(false);
 const functions=await q<{name:string;definer:boolean;config:string[];public_execute:boolean}>("SELECT proname AS name,prosecdef AS definer,proconfig AS config,has_function_privilege('public',oid,'EXECUTE') AS public_execute FROM pg_proc WHERE proname IN ('client_document_public','client_document_audit_record','client_document_guard','client_document_delivery_guard','contract_template_guard','estimate_terms_guard')");
 expect(functions).toHaveLength(6);for(const f of functions){expect(f.public_execute).toBe(false);expect(f.config).toContain('search_path=pg_catalog, public');expect(f.definer).toBe(['client_document_public','client_document_audit_record'].includes(f.name));}
 expect(await q("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('client_document_guard','client_document_audit','client_document_delivery_guard','client_document_delivery_audit','contract_template_guard','contract_template_audit','estimate_terms_guard')")).toHaveLength(7);
});

it('keeps time entries tenant-scoped, audited, revisioned and restricted to Accounting',async()=>{
 const [table]=await q<{enabled:boolean;forced:boolean}>("SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced FROM pg_class WHERE oid='time_entry'::regclass");expect(table).toEqual({enabled:true,forced:true});
 const policies=await q<{qual:string|null;with_check:string|null}>("SELECT qual,with_check FROM pg_policies WHERE tablename='time_entry' AND permissive='RESTRICTIVE'");expect(policies).toHaveLength(4);for(const p of policies)expect(`${p.qual}${p.with_check}`).toContain('accounting');
 expect(await q("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid='time_entry'::regclass")).toHaveLength(2);
 expect((await q<{ok:boolean}>("SELECT has_table_privilege('allumi_app','time_entry','TRUNCATE') AS ok"))[0]?.ok).toBe(false);
 const [guard]=await q<{definer:boolean;public_execute:boolean;config:string[]}>("SELECT prosecdef AS definer,has_function_privilege('public',oid,'EXECUTE') AS public_execute,proconfig AS config FROM pg_proc WHERE oid='time_entry_guard()'::regprocedure");expect(guard).toMatchObject({definer:false,public_execute:false});expect(guard?.config).toContain('search_path=pg_catalog, public');
});

it('locks the public source state when reserving client-document mail',async()=>{
 const [f]=await q<{body:string}>("SELECT pg_get_functiondef(oid) AS body FROM pg_proc WHERE proname='client_document_delivery_guard'");expect(f?.body).toContain("'SENT', 'ACCEPTED', 'CONVERTED'".replaceAll(', ',','));expect(f?.body).toContain('FOR SHARE');expect(f?.body).toContain("status='POSTED'");
});

it('restricts signed-copy capabilities to a stable read-only function with fixed search path',async()=>{
 const [f]=await q<{definer:boolean;volatility:string;config:string[];public_execute:boolean;app_execute:boolean;body:string}>("SELECT prosecdef AS definer,provolatile AS volatility,proconfig AS config,has_function_privilege('public',oid,'EXECUTE') AS public_execute,has_function_privilege('allumi_app',oid,'EXECUTE') AS app_execute,pg_get_functiondef(oid) AS body FROM pg_proc WHERE oid='client_document_public_copy(text)'::regprocedure");
 expect(f).toMatchObject({definer:true,volatility:'s',public_execute:false,app_execute:true});expect(f?.config).toContain('search_path=pg_catalog, public');expect(f?.body).toContain('statement_timestamp()');expect(f?.body).toContain('sha256');expect(f?.body).not.toMatch(/\b(UPDATE|INSERT|DELETE|EXECUTE)\b/);
});
