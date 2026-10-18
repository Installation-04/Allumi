import { readFileSync } from "node:fs";
import pg from "pg";

/**
 * Shared fixtures for the database-level tests (tests/integration/*-rules.test.ts): two companies, four
 * users, a chart of accounts, taxes, one invitation. The ids are fixed so a test can name what it uses.
 * Each test file has its own database (cloned from the migrated template), so the world is loaded once per file.
 */
export const W = {
  userOwnerA: "00000000-0000-7000-8000-000000000001",
  userOwnerB: "00000000-0000-7000-8000-000000000002",
  userReader: "00000000-0000-7000-8000-000000000003",
  userAccountant: "00000000-0000-7000-8000-000000000004",
  companyA: "00000000-0000-7000-8000-00000000000a",
  companyB: "00000000-0000-7000-8000-00000000000b",
  fiscalYearA: "00000000-0000-7000-8000-0000000000fa",
  fiscalYearB: "00000000-0000-7000-8000-0000000000fb",
  bank: "00000000-0000-7000-8000-00000000a100",
  undeposited: "00000000-0000-7000-8000-00000000a105",
  receivable: "00000000-0000-7000-8000-00000000a110",
  gstReceivable: "00000000-0000-7000-8000-00000000a120",
  qstReceivable: "00000000-0000-7000-8000-00000000a125",
  payable: "00000000-0000-7000-8000-00000000a200",
  gstPayable: "00000000-0000-7000-8000-00000000a210",
  qstPayable: "00000000-0000-7000-8000-00000000a215",
  capital: "00000000-0000-7000-8000-00000000a300",
  sales: "00000000-0000-7000-8000-00000000a400",
  expenses: "00000000-0000-7000-8000-00000000a500",
  bankB: "00000000-0000-7000-8000-00000000b100",
  customer: "00000000-0000-7000-8000-00000000c001",
  otherCustomer: "00000000-0000-7000-8000-00000000c002",
  supplier: "00000000-0000-7000-8000-00000000c003",
  gst: "00000000-0000-7000-8000-00000000d001",
  qst: "00000000-0000-7000-8000-00000000d002",
  taxCodeStandard: "00000000-0000-7000-8000-00000000e001",
  taxCodeExempt: "00000000-0000-7000-8000-00000000e002",
} as const;

/** Loads the fixtures as the table owner (they bypass row level security on purpose). */
export async function seedWorld(owner: pg.Client): Promise<void> {
  await owner.query(readFileSync(new URL("./world.sql", import.meta.url), "utf8"));
}

/** A connection with the restricted role, exactly like the application's. */
export async function appClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  await client.connect();
  return client;
}

export type Context = { userId?: string; companyId?: string };
export const asOwnerA: Context = { userId: W.userOwnerA, companyId: W.companyA };
export const asReader: Context = { userId: W.userReader, companyId: W.companyA };
export const asAccountant: Context = { userId: W.userAccountant, companyId: W.companyA };
export const asOwnerB: Context = { userId: W.userOwnerB, companyId: W.companyB };

export async function setContext(client: pg.Client, ctx: Context): Promise<void> {
  await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)", [ctx.userId ?? "", ctx.companyId ?? ""]);
}

/**
 * Runs `fn` in one transaction under a user/company context, fires the deferred checks (balanced entries,
 * invoice postings...) like a COMMIT would, then rolls everything back so tests do not see each other.
 * Pass `commit: true` for the few tests that need their effects to persist.
 */
export async function inContext<T>(client: pg.Client, ctx: Context, fn: () => Promise<T>, options: { commit?: boolean } = {}): Promise<T> {
  await client.query("BEGIN");
  try {
    await setContext(client, ctx);
    const result = await fn();
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query(options.commit ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** The SQLSTATE raised by `fn` (a database error code such as "AL001" or "42501"), or null if it succeeds. */
export async function sqlstate(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    throw error;
  }
}

export type EntryInput = { id: string; no: number; date: string; source?: string; reverses?: string | null; sourceId?: string | null };

/** Inserts a journal entry in the fiscal period of its date (as the application does). */
export async function entry(client: pg.Client, e: EntryInput): Promise<void> {
  await client.query(
    `INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, source_id, reverses_entry_id, created_by_id)
     SELECT $1, app_tenant_id(), $2, $3::date, fp.id, $4::journal_source, $5, $6, app_current_user_id()
       FROM fiscal_period fp WHERE fp.company_id = app_tenant_id() AND $3::date BETWEEN fp.start_date AND fp.end_date`,
    [e.id, e.no, e.date, e.source ?? "MANUAL", e.sourceId ?? null, e.reverses ?? null],
  );
}

export type LineInput = { debit?: number; credit?: number; contact?: string | null; tax?: string | null; box?: string | null };

/** Inserts a journal line; the line takes the date of its entry. */
export async function line(client: pg.Client, entryId: string, no: number, account: string, l: LineInput = {}): Promise<void> {
  await client.query(
    `INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, contact_id, entry_date, tax_id, tax_box)
     SELECT gen_random_uuid(), app_tenant_id(), $1, $2, $3, $4, $5, $6, e.entry_date, $7, $8::tax_box
       FROM journal_entry e WHERE e.id = $1`,
    [entryId, no, account, l.debit ?? 0, l.credit ?? 0, l.contact ?? null, l.tax ?? null, l.box ?? null],
  );
}
