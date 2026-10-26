import { randomUUID } from "node:crypto";
import fc from "fast-check";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { owner } from "./helpers";
import { appClient, asOwnerA, asOwnerB, asReader, entry, inContext, line, seedWorld, setContext, sqlstate, W, type LineInput } from "./world";

/**
 * Ledger rules enforced by the database: double entry, immutability, transaction stamp, control accounts and
 * tax tags, reversals, fiscal periods and years, the chart of accounts, tax rate overlap, uniqueness and the
 * constraints of journal lines. Ported from the phase 1 SQL cases T01..T22 (smoke_app.sql), the owner and
 * concurrency scripts, plus the rules that had no SQL case yet.
 *
 * Every test runs in a transaction that is rolled back, except the few that need an earlier committed
 * transaction (they build their own state, with fresh ids and entry numbers, so the tests are order independent).
 * `inContext` fires the deferred checks (balance, completeness...) before the rollback, like a COMMIT would:
 * an entry left incomplete at the end of a test would fail it, so each test completes the entries it opens.
 */

let db: pg.Client; // table owner (superuser): fixtures, owner-level checks, verifications outside a context
let app: pg.Client; // the restricted application role, exactly like the application

beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  app = await appClient();
});
afterAll(async () => {
  await app.end();
  await db.end();
});

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

let entryCounter = 1000;
/** A fresh entry number: tests never reuse one, so committed entries cannot collide with later tests. */
const nextNumber = (): number => ++entryCounter;
let accountCounter = 9000;

type PostLine = readonly [account: string, debit: number, credit: number, extra?: Omit<LineInput, "debit" | "credit">];
type HeaderSpec = { id?: string; no?: number; source?: string; reverses?: string; sourceId?: string };
type PostSpec = HeaderSpec & { date: string; lines: readonly PostLine[] };

const bankCapital = (cents: number): PostLine[] => [
  [W.bank, cents, 0],
  [W.capital, 0, cents],
];

/** The SQLSTATE of a statement (or action) run inside a savepoint, so that the transaction stays usable. */
async function attempt(client: pg.Client, action: string | (() => Promise<unknown>), params: unknown[] = []): Promise<string | null> {
  await client.query("SAVEPOINT attempt");
  const code = await sqlstate(() => (typeof action === "string" ? client.query(action, params) : action()));
  await client.query(code === null ? "RELEASE SAVEPOINT attempt" : "ROLLBACK TO SAVEPOINT attempt");
  return code;
}

async function one<T extends Record<string, unknown>>(client: pg.Client, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await client.query(sql, params);
  const row = rows[0] as T | undefined;
  if (!row) throw new Error(`no row returned by: ${sql}`);
  return row;
}

async function lineCount(client: pg.Client, entryId: string): Promise<number> {
  return (await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM journal_line WHERE entry_id = $1", [entryId])).n;
}

/** Creates an entry header (and checks that it exists: the helper inserts nothing when the date has no period). */
async function openEntry(client: pg.Client, date: string, header: HeaderSpec = {}): Promise<string> {
  const id = header.id ?? randomUUID();
  await entry(client, { id, no: header.no ?? nextNumber(), date, source: header.source, reverses: header.reverses, sourceId: header.sourceId });
  if ((await client.query("SELECT 1 FROM journal_entry WHERE id = $1", [id])).rowCount !== 1) throw new Error(`fixture error: no entry created for ${date}`);
  return id;
}

/** Posts a complete entry (header and lines). */
async function post(client: pg.Client, spec: PostSpec): Promise<string> {
  const id = await openEntry(client, spec.date, spec);
  let no = 0;
  for (const [account, debit, credit, extra] of spec.lines) await line(client, id, ++no, account, { ...extra, debit, credit });
  return id;
}

async function newAccount(client: pg.Client, type: string, subtype: string, parent: string | null = null): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO account (id, company_id, code, name_fr, name_en, type, subtype, parent_id, updated_at)
     VALUES ($1, app_tenant_id(), $2, 'Compte de test', 'Test account', $3::account_type, $4::account_subtype, $5, now())`,
    [id, String(++accountCounter), type, subtype, parent],
  );
  return id;
}

/** A fiscal year of `year` with `months` monthly periods (the application creates a year and its periods together). */
async function newYear(client: pg.Client, year: number, months = 12): Promise<string> {
  const id = randomUUID();
  await client.query("INSERT INTO fiscal_year (id, company_id, start_date, end_date) VALUES ($1, app_tenant_id(), make_date($2, 1, 1), make_date($2, 12, 31))", [id, year]);
  await client.query(
    `INSERT INTO fiscal_period (id, company_id, fiscal_year_id, period_number, start_date, end_date)
     SELECT gen_random_uuid(), app_tenant_id(), $1, m, make_date($2, m, 1), (make_date($2, m, 1) + interval '1 month - 1 day')::date
       FROM generate_series(1, $3::int) m`,
    [id, year, months],
  );
  return id;
}

async function lockYear(client: pg.Client, yearId: string): Promise<void> {
  await client.query(
    "UPDATE fiscal_period SET status = 'LOCKED', locked_at = now(), locked_by_id = app_current_user_id() WHERE company_id = app_tenant_id() AND fiscal_year_id = $1",
    [yearId],
  );
}

const CLOSE_YEAR = "UPDATE fiscal_year SET status = 'CLOSED', closed_at = now(), closed_by_id = app_current_user_id() WHERE id = $1";

async function lockPeriod(client: pg.Client, periodNumber: number): Promise<void> {
  const result = await client.query(
    "UPDATE fiscal_period SET status = 'LOCKED', locked_at = now(), locked_by_id = app_current_user_id() WHERE company_id = app_tenant_id() AND period_number = $1 AND fiscal_year_id = $2",
    [periodNumber, W.fiscalYearA],
  );
  expect(result.rowCount).toBe(1);
}

/**
 * A posted receipt (payment entry crediting the receivables control account), as the application writes it.
 * `afterBankLine` runs between the two lines, for the tests that try something wrong at that point.
 */
async function receipt(client: pg.Client, date: string, cents: number, afterBankLine?: (entryId: string) => Promise<void>): Promise<{ paymentId: string; entryId: string }> {
  const paymentId = randomUUID();
  const entryId = await openEntry(client, date, { source: "PAYMENT", sourceId: paymentId });
  await line(client, entryId, 1, W.bank, { debit: cents });
  await afterBankLine?.(entryId);
  await line(client, entryId, 2, W.receivable, { credit: cents, contact: W.customer });
  await client.query(
    `INSERT INTO payment (id, company_id, direction, ledger, contact_id, payment_date, amount_cents, account_id, method, journal_entry_id, created_by_id, updated_at)
     VALUES ($1, app_tenant_id(), 'RECEIVED', 'RECEIVABLE', $2, $3::date, $4, $5, 'EFT', $6, app_current_user_id(), now())`,
    [paymentId, W.customer, date, cents, W.bank, entryId],
  );
  return { paymentId, entryId };
}

async function waitUntil(condition: () => Promise<boolean>, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** True while the backend `pid` waits for a lock held by another transaction. */
async function isWaitingForLock(pid: number): Promise<boolean> {
  const row = await db.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid]);
  return row.rows[0]?.wait_event_type === "Lock";
}

/** Opens a transaction on its own connection, in the context of the owner of company A. */
async function openSession(): Promise<pg.Client> {
  const client = await appClient();
  await client.query("BEGIN");
  await setContext(client, asOwnerA);
  return client;
}

async function closeSession(client: pg.Client): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}

// ---------------------------------------------------------------------------------------------------------
// Double entry
// ---------------------------------------------------------------------------------------------------------

describe("double entry", () => {
  it("T01 accepts a balanced manual entry", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await post(app, { date: "2026-02-10", lines: bankCapital(100_000) });
      await app.query("SET CONSTRAINTS ALL IMMEDIATE");
      const totals = await one<{ lines: number; debits: string; credits: string }>(
        app,
        "SELECT count(*)::int AS lines, sum(debit_cents)::text AS debits, sum(credit_cents)::text AS credits FROM journal_line WHERE entry_id = $1",
        [id],
      );
      expect(totals).toEqual({ lines: 2, debits: "100000", credits: "100000" });
    });
  });

  it("T02 rejects an unbalanced entry (AL001)", async () => {
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, () =>
        post(app, {
          date: "2026-02-11",
          lines: [
            [W.bank, 100, 0],
            [W.capital, 0, 99],
          ],
        }),
      ),
    );
    expect(code).toBe("AL001");
  });

  it("T03 rejects a one-line entry (AL002)", async () => {
    const code = await sqlstate(() => inContext(app, asOwnerA, () => post(app, { date: "2026-02-11", lines: [[W.bank, 100, 0]] })));
    expect(code).toBe("AL002");
  });

  it("T04 rejects an entry without lines (AL002)", async () => {
    const code = await sqlstate(() => inContext(app, asOwnerA, () => openEntry(app, "2026-02-11")));
    expect(code).toBe("AL002");
  });

  it("T05 rejects a line with both a debit and a credit (23514)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-11");
      await line(app, id, 1, W.bank, { debit: 100 }); // a correct line is accepted
      expect(await attempt(app, () => line(app, id, 2, W.bank, { debit: 100, credit: 100 }))).toBe("23514");
      await line(app, id, 2, W.capital, { credit: 100 });
    });
  });

  it.each<[label: string, amounts: LineInput]>([
    ["a negative debit", { debit: -100 }],
    ["a negative credit", { credit: -100 }],
    ["a zero debit and a zero credit", { debit: 0, credit: 0 }],
    ["a debit above the 1 000 billion dollar cap", { debit: 100_000_000_000_001 }],
    ["a credit above the 1 000 billion dollar cap", { credit: 100_000_000_000_001 }],
  ])("rejects %s on a line (23514)", async (_label, amounts) => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-11");
      await line(app, id, 1, W.bank, { debit: 100 });
      expect(await attempt(app, () => line(app, id, 2, W.capital, amounts))).toBe("23514");
      await line(app, id, 2, W.capital, { credit: 100 });
    });
  });

  it("accepts a line at exactly the cap of 1 000 billion dollars", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await post(app, { date: "2026-02-11", lines: bankCapital(100_000_000_000_000) });
      expect(await lineCount(app, id)).toBe(2);
    });
  });

  it("rejects a line number below 1 (23514)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-11");
      expect(await attempt(app, () => line(app, id, 0, W.bank, { debit: 100 }))).toBe("23514");
      await line(app, id, 1, W.bank, { debit: 100 });
      await line(app, id, 2, W.capital, { credit: 100 });
    });
  });

  it("rejects a tax tag without a tax and a tax without a tag (23514)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-11");
      await line(app, id, 1, W.gstPayable, { credit: 5, tax: W.gst, box: "COLLECTED" }); // tagged correctly: accepted
      expect(await attempt(app, () => line(app, id, 2, W.bank, { debit: 5, box: "COLLECTED" }))).toBe("23514"); // box without tax
      expect(await attempt(app, () => line(app, id, 2, W.gstPayable, { credit: 5, tax: W.gst }))).toBe("23514"); // tax without box
      await line(app, id, 2, W.bank, { debit: 5 });
    });
  });

  it("checks each entry by itself: a surplus in one entry is not covered by another (AL001)", async () => {
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, async () => {
        // 10 cents too many debits here, 10 cents too many credits there: together they balance, separately they do not
        await post(app, {
          date: "2026-02-11",
          lines: [
            [W.bank, 70, 0],
            [W.capital, 0, 60],
          ],
        });
        await post(app, {
          date: "2026-02-11",
          lines: [
            [W.expenses, 10, 0],
            [W.bank, 0, 20],
          ],
        });
      }),
    );
    expect(code).toBe("AL001");
  });
});

// ---------------------------------------------------------------------------------------------------------
// Immutability: privileges for the application role, triggers for everyone (the table owner included)
// ---------------------------------------------------------------------------------------------------------

describe("append-only journal", () => {
  it("T06 refuses an UPDATE of a journal line to the application role (42501)", async () => {
    await inContext(app, asOwnerA, async () => {
      await post(app, { date: "2026-02-10", lines: bankCapital(100) });
      expect(await attempt(app, "UPDATE journal_line SET debit_cents = debit_cents + 1")).toBe("42501");
    });
  });

  it("T07 refuses a DELETE of a journal entry to the application role (42501)", async () => {
    await inContext(app, asOwnerA, async () => {
      await post(app, { date: "2026-02-10", lines: bankCapital(100) });
      expect(await attempt(app, "DELETE FROM journal_entry")).toBe("42501");
    });
  });

  it.each<[label: string, sql: string]>([
    ["UPDATE of a journal entry", "UPDATE journal_entry SET memo = 'edited'"],
    ["DELETE of a journal line", "DELETE FROM journal_line"],
    ["TRUNCATE of the journal lines", "TRUNCATE journal_line"],
    ["TRUNCATE of the journal entries", "TRUNCATE journal_entry"],
    ["UPDATE of the audit trail", "UPDATE audit_log SET action = 'row.delete'"],
    ["DELETE from the audit trail", "DELETE FROM audit_log"],
    ["TRUNCATE of the audit trail", "TRUNCATE audit_log"],
  ])("refuses %s to the application role (42501)", async (_label, sql) => {
    await inContext(app, asOwnerA, async () => {
      await post(app, { date: "2026-02-10", lines: bankCapital(100) });
      expect(await attempt(app, sql)).toBe("42501");
    });
  });

  it("lets the application role insert and read journal rows (positive control for the refusals above)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await post(app, { date: "2026-02-10", lines: bankCapital(100) });
      expect(await lineCount(app, id)).toBe(2);
      expect((await app.query("SELECT 1 FROM journal_entry WHERE id = $1", [id])).rowCount).toBe(1);
    });
  });

  // The table owner is a superuser here, so privileges do not stop it: the triggers must (AL004).
  describe("even for the table owner", () => {
    it("lets the owner insert a balanced entry (positive control)", async () => {
      await inContext(db, asOwnerA, async () => {
        const id = await post(db, { date: "2026-02-10", lines: bankCapital(100) });
        expect(await lineCount(db, id)).toBe(2);
      });
    });

    it.each<[label: string, sql: string]>([
      ["UPDATE of a journal line", "UPDATE journal_line SET debit_cents = debit_cents"],
      ["DELETE of a journal line", "DELETE FROM journal_line"],
      ["UPDATE of a journal entry", "UPDATE journal_entry SET memo = 'edited'"],
      ["DELETE of a journal entry", "DELETE FROM journal_entry"],
      // CASCADE: a plain TRUNCATE of a table that others reference fails on its foreign keys before any trigger could fire.
      ["TRUNCATE of the journal lines", "TRUNCATE journal_line CASCADE"],
      ["TRUNCATE of the journal entries", "TRUNCATE journal_entry CASCADE"],
      ["UPDATE of the audit trail", "UPDATE audit_log SET action = 'row.delete'"],
      ["DELETE from the audit trail", "DELETE FROM audit_log"],
      ["TRUNCATE of the audit trail", "TRUNCATE audit_log"],
    ])("refuses %s (AL004)", async (_label, sql) => {
      await inContext(db, asOwnerA, async () => {
        await post(db, { date: "2026-02-10", lines: bankCapital(100) }); // there are rows for the row-level triggers to refuse
        await db.query("SET CONSTRAINTS ALL IMMEDIATE"); // TRUNCATE is refused by PostgreSQL itself while deferred checks are pending
        expect(await attempt(db, sql)).toBe("AL004");
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Transaction stamp: lines can only be added by the transaction that created the entry
// ---------------------------------------------------------------------------------------------------------

describe("transaction stamp", () => {
  /** An entry committed by an earlier transaction. */
  const committedEntry = (): Promise<string> => inContext(app, asOwnerA, () => post(app, { date: "2026-02-10", lines: bankCapital(100_000) }), { commit: true });

  it("T08 rejects lines added to an entry from an earlier transaction (AL004)", async () => {
    const id = await committedEntry();
    expect(await lineCount(db, id)).toBe(2); // the committed entry is complete
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, async () => {
        await line(app, id, 3, W.bank, { debit: 500 });
        await line(app, id, 4, W.capital, { credit: 500 });
      }),
    );
    expect(code).toBe("AL004");
    expect(await lineCount(db, id)).toBe(2);
  });

  it("T09 rejects lines added to an old entry even with a forged registry setting (AL004)", async () => {
    const id = await committedEntry();
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, async () => {
        await app.query("SELECT set_config('allumi.open_entries', $1, true)", [`${id};`]);
        await line(app, id, 3, W.bank, { debit: 500 });
        await line(app, id, 4, W.capital, { credit: 500 });
      }),
    );
    expect(code).toBe("AL004");
    expect(await lineCount(db, id)).toBe(2);
  });

  it("rejects lines added to an old entry by the table owner too (AL004)", async () => {
    const id = await committedEntry();
    const code = await sqlstate(() => inContext(db, asOwnerA, () => line(db, id, 3, W.bank, { debit: 500 })));
    expect(code).toBe("AL004");
    expect(await lineCount(db, id)).toBe(2);
  });

  it("T08b accepts lines added inside a savepoint of the creating transaction", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-10");
      await line(app, id, 1, W.bank, { debit: 500 });
      await app.query("SAVEPOINT inner_work");
      await line(app, id, 2, W.capital, { credit: 500 }); // same top-level transaction: allowed
      await app.query("RELEASE SAVEPOINT inner_work");
      expect(await lineCount(app, id)).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Control accounts and tax tags
// ---------------------------------------------------------------------------------------------------------

describe("control accounts and tax tags", () => {
  it("T10 rejects a manual posting to the receivables control account (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-12");
      expect(await attempt(app, () => line(app, id, 1, W.receivable, { debit: 100, contact: W.customer }))).toBe("AL005");
      await line(app, id, 1, W.bank, { debit: 100, contact: W.customer }); // a contact on an ordinary account is fine
      await line(app, id, 2, W.capital, { credit: 100 });
    });
  });

  it("rejects a manual posting to the payables control account (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-12");
      expect(await attempt(app, () => line(app, id, 1, W.payable, { credit: 100, contact: W.supplier }))).toBe("AL005");
      await line(app, id, 1, W.bank, { debit: 100 });
      await line(app, id, 2, W.capital, { credit: 100 });
    });
  });

  it("accepts a payment entry on the receivables control account when the line carries the contact", async () => {
    await inContext(app, asOwnerA, async () => {
      const { entryId } = await receipt(app, "2026-04-10", 5000);
      await app.query("SET CONSTRAINTS ALL IMMEDIATE");
      expect(await lineCount(app, entryId)).toBe(2);
    });
  });

  it("rejects a control account line without a contact, even from a payment (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      await receipt(app, "2026-04-10", 5000, async (entryId) => {
        expect(await attempt(app, () => line(app, entryId, 2, W.receivable, { credit: 5000 }))).toBe("AL005");
      });
    });
  });

  it("T11 rejects a tax account line without a tax tag (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-12");
      await line(app, id, 1, W.bank, { debit: 500 });
      expect(await attempt(app, () => line(app, id, 2, W.gstPayable, { credit: 500 }))).toBe("AL005");
      await line(app, id, 2, W.sales, { credit: 500 });
    });
  });

  it("accepts a tax account line carrying its tax and its return box", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await post(app, {
        date: "2026-02-12",
        lines: [
          [W.bank, 105, 0],
          [W.sales, 0, 100],
          [W.gstPayable, 0, 5, { tax: W.gst, box: "COLLECTED" }],
        ],
      });
      await app.query("SET CONSTRAINTS ALL IMMEDIATE");
      expect(await lineCount(app, id)).toBe(3);
    });
  });

  it("rejects a tax account that does not belong to the tax of the line (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-12");
      expect(await attempt(app, () => line(app, id, 1, W.gstPayable, { credit: 5, tax: W.qst, box: "COLLECTED" }))).toBe("AL005");
      await line(app, id, 1, W.qstPayable, { credit: 5, tax: W.qst, box: "COLLECTED" }); // the QST account with the QST tax
      await line(app, id, 2, W.bank, { debit: 5 });
    });
  });

  it("rejects a tax tag on an ordinary account (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-12");
      expect(await attempt(app, () => line(app, id, 1, W.bank, { debit: 5, tax: W.gst, box: "COLLECTED" }))).toBe("AL005");
      await line(app, id, 1, W.bank, { debit: 5 });
      await line(app, id, 2, W.capital, { credit: 5 });
    });
  });

  it("keeps the settlement box for tax settlement entries (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const manual = await openEntry(app, "2026-02-12");
      expect(await attempt(app, () => line(app, manual, 1, W.gstPayable, { debit: 5, tax: W.gst, box: "SETTLEMENT" }))).toBe("AL005");
      await line(app, manual, 1, W.bank, { debit: 5 });
      await line(app, manual, 2, W.capital, { credit: 5 });

      const settlement = await openEntry(app, "2026-02-12", { source: "TAX_SETTLEMENT" });
      expect(await attempt(app, () => line(app, settlement, 1, W.gstPayable, { debit: 5, tax: W.gst, box: "COLLECTED" }))).toBe("AL005");
      await line(app, settlement, 1, W.gstPayable, { debit: 5, tax: W.gst, box: "SETTLEMENT" });
      await line(app, settlement, 2, W.bank, { credit: 5 });
    });
  });

  it("freezes the tax lines of a period covered by a filed return (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      await app.query(
        `INSERT INTO tax_return (id, company_id, tax_id, period_start, period_end, status, filed_at, filed_by_id, created_by_id, updated_at)
         VALUES (gen_random_uuid(), app_tenant_id(), $1, '2026-01-01', '2026-03-31', 'FILED', now(), app_current_user_id(), app_current_user_id(), now())`,
        [W.gst],
      );
      const inside = await openEntry(app, "2026-02-12");
      expect(await attempt(app, () => line(app, inside, 1, W.gstPayable, { credit: 5, tax: W.gst, box: "COLLECTED" }))).toBe("AL003");
      await line(app, inside, 1, W.bank, { debit: 5 });
      await line(app, inside, 2, W.capital, { credit: 5 });
      // the next quarter is not filed, and the QST return is another one
      await post(app, {
        date: "2026-04-12",
        lines: [
          [W.bank, 5, 0],
          [W.gstPayable, 0, 5, { tax: W.gst, box: "COLLECTED" }],
        ],
      });
      await post(app, {
        date: "2026-02-13",
        lines: [
          [W.bank, 5, 0],
          [W.qstPayable, 0, 5, { tax: W.qst, box: "COLLECTED" }],
        ],
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Reversals
// ---------------------------------------------------------------------------------------------------------

describe("reversals", () => {
  const mirror = (cents: number): PostLine[] => [
    [W.bank, 0, cents],
    [W.capital, cents, 0],
  ];
  const expensePaidByBank: PostLine[] = [
    [W.expenses, 4000, 0],
    [W.bank, 0, 4000],
  ];

  it("T12 accepts a reversal that mirrors the entry", async () => {
    await inContext(app, asOwnerA, async () => {
      const original = await post(app, { date: "2026-02-10", lines: bankCapital(100_000) });
      const reversal = await post(app, { date: "2026-02-20", source: "REVERSAL", reverses: original, lines: mirror(100_000) });
      await app.query("SET CONSTRAINTS ALL IMMEDIATE");
      expect(await lineCount(app, reversal)).toBe(2);
    });
  });

  it("accepts a reversal dated the same day as the entry, and one that mirrors tax tags and contacts", async () => {
    await inContext(app, asOwnerA, async () => {
      const original = await post(app, {
        date: "2026-02-10",
        lines: [
          [W.bank, 105, 0, { contact: W.customer }],
          [W.sales, 0, 100],
          [W.gstPayable, 0, 5, { tax: W.gst, box: "COLLECTED" }],
        ],
      });
      const reversal = await post(app, {
        date: "2026-02-10",
        source: "REVERSAL",
        reverses: original,
        lines: [
          [W.bank, 0, 105, { contact: W.customer }],
          [W.sales, 100, 0],
          [W.gstPayable, 5, 0, { tax: W.gst, box: "COLLECTED" }],
        ],
      });
      await app.query("SET CONSTRAINTS ALL IMMEDIATE");
      expect(await lineCount(app, reversal)).toBe(3);
    });
  });

  it("T13 rejects a second reversal of the same entry (23505)", async () => {
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, async () => {
        const original = await post(app, { date: "2026-02-10", lines: bankCapital(100_000) });
        await post(app, { date: "2026-02-20", source: "REVERSAL", reverses: original, lines: mirror(100_000) });
        await openEntry(app, "2026-02-21", { source: "REVERSAL", reverses: original });
      }),
    );
    expect(code).toBe("23505");
  });

  it("T14 rejects the reversal of a reversal (AL008)", async () => {
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, async () => {
        const original = await post(app, { date: "2026-02-10", lines: bankCapital(100_000) });
        const reversal = await post(app, { date: "2026-02-20", source: "REVERSAL", reverses: original, lines: mirror(100_000) });
        await openEntry(app, "2026-02-21", { source: "REVERSAL", reverses: reversal });
      }),
    );
    expect(code).toBe("AL008");
  });

  it("T15 posts the expense entry that the next tests reverse", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await post(app, { date: "2026-06-20", lines: expensePaidByBank });
      await app.query("SET CONSTRAINTS ALL IMMEDIATE");
      expect(await lineCount(app, id)).toBe(2);
    });
  });

  it("T16 rejects a reversal dated before the reversed entry (AL008)", async () => {
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, async () => {
        const original = await post(app, { date: "2026-06-20", lines: expensePaidByBank });
        await openEntry(app, "2026-04-02", { source: "REVERSAL", reverses: original });
      }),
    );
    expect(code).toBe("AL008");
  });

  it("T17 rejects a reversal that does not mirror the entry (AL008)", async () => {
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, async () => {
        const original = await post(app, { date: "2026-06-20", lines: expensePaidByBank });
        await post(app, {
          date: "2026-06-21",
          source: "REVERSAL",
          reverses: original,
          lines: [
            [W.bank, 3000, 0],
            [W.expenses, 0, 3000],
          ],
        });
      }),
    );
    expect(code).toBe("AL008");
  });

  it("rejects a reversal that repeats the entry instead of swapping its sides (AL008)", async () => {
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, async () => {
        const original = await post(app, { date: "2026-02-10", lines: bankCapital(100) });
        await post(app, { date: "2026-02-11", source: "REVERSAL", reverses: original, lines: bankCapital(100) });
      }),
    );
    expect(code).toBe("AL008");
  });

  it("rejects a reversal of an entry that does not exist (AL008)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, () => openEntry(app, "2026-02-11", { source: "REVERSAL", reverses: randomUUID() }))).toBe("AL008");
    });
  });

  it("rejects the reversal of a payment entry unless the payment is voided (AL008)", async () => {
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, async () => {
        const { entryId } = await receipt(app, "2026-04-10", 5000);
        await post(app, {
          date: "2026-04-11",
          source: "REVERSAL",
          reverses: entryId,
          lines: [
            [W.bank, 0, 5000],
            [W.receivable, 5000, 0, { contact: W.customer }],
          ],
        });
      }),
    );
    expect(code).toBe("AL008");
  });

  it("requires the reversal link to match the source type (23514)", async () => {
    await inContext(app, asOwnerA, async () => {
      const original = await post(app, { date: "2026-02-10", lines: bankCapital(100) });
      expect(await attempt(app, () => openEntry(app, "2026-02-11", { source: "REVERSAL" }))).toBe("23514"); // a reversal of nothing
      expect(await attempt(app, () => openEntry(app, "2026-02-11", { source: "MANUAL", reverses: original }))).toBe("23514"); // not a reversal
    });
  });

  it("requires a source id exactly for the entries that come from a document, payment, deposit or bank line (23514)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, () => openEntry(app, "2026-02-11", { source: "MANUAL", sourceId: randomUUID() }))).toBe("23514");
      expect(await attempt(app, () => openEntry(app, "2026-02-11", { source: "PAYMENT" }))).toBe("23514");
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Fiscal periods
// ---------------------------------------------------------------------------------------------------------

describe("fiscal periods", () => {
  it("T18 locks a period", async () => {
    await inContext(app, asOwnerA, async () => {
      await lockPeriod(app, 3);
      const march = await one<{ status: string; locked: boolean }>(
        app,
        "SELECT status::text AS status, locked_at IS NOT NULL AS locked FROM fiscal_period WHERE company_id = app_tenant_id() AND period_number = 3",
      );
      expect(march).toEqual({ status: "LOCKED", locked: true });
    });
  });

  it("T19 rejects posting into a locked period (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      await post(app, { date: "2026-02-15", lines: bankCapital(100) }); // an open period accepts the entry
      await lockPeriod(app, 3);
      expect(await attempt(app, () => openEntry(app, "2026-03-15"))).toBe("AL003");
      await post(app, { date: "2026-04-15", lines: bankCapital(100) }); // the neighbours stay open
    });
  });

  it("accepts posting again once the period is reopened", async () => {
    await inContext(app, asOwnerA, async () => {
      await lockPeriod(app, 3);
      expect(await attempt(app, () => openEntry(app, "2026-03-15"))).toBe("AL003");
      await app.query("UPDATE fiscal_period SET status = 'OPEN', locked_at = NULL, locked_by_id = NULL WHERE company_id = app_tenant_id() AND period_number = 3");
      await post(app, { date: "2026-03-15", lines: bankCapital(100) });
    });
  });

  it("T20 rejects an entry date outside the period it references (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      const insertInFebruary = (date: string, id: string = randomUUID()) =>
        app.query(
          `INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, created_by_id)
           SELECT $3, app_tenant_id(), $1, $2::date, id, 'MANUAL', app_current_user_id()
             FROM fiscal_period WHERE company_id = app_tenant_id() AND period_number = 2`,
          [nextNumber(), date, id],
        );
      expect(await attempt(app, () => insertInFebruary("2026-04-15"))).toBe("AL003"); // April in the February period
      expect(await attempt(app, () => insertInFebruary("2026-01-31"))).toBe("AL003"); // the day before it starts
      expect(await attempt(app, () => insertInFebruary("2026-03-01"))).toBe("AL003"); // the day after it ends
      const id = randomUUID();
      expect((await insertInFebruary("2026-02-28", id)).rowCount).toBe(1); // its last day is inside
      await line(app, id, 1, W.bank, { debit: 100 });
      await line(app, id, 2, W.capital, { credit: 100 });
    });
  });

  it("rejects an entry that references a period that does not exist (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      const code = await attempt(app, () =>
        app.query(
          `INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, created_by_id)
           VALUES (gen_random_uuid(), app_tenant_id(), $1, '2026-02-10', gen_random_uuid(), 'MANUAL', app_current_user_id())`,
          [nextNumber()],
        ),
      );
      expect(code).toBe("AL003");
    });
  });

  describe("period guard", () => {
    it.each<[column: string, change: string]>([
      ["period_number", "period_number = 13"],
      ["start_date", "start_date = start_date + 1"],
      ["end_date", "end_date = end_date - 1"],
      ["fiscal_year_id", `fiscal_year_id = '${W.fiscalYearB}'`],
    ])("refuses to change %s of a period (AL003)", async (_column, change) => {
      await inContext(app, asOwnerA, async () => {
        await lockPeriod(app, 12); // the allowed change works on the same row
        expect(await attempt(app, `UPDATE fiscal_period SET ${change} WHERE company_id = app_tenant_id() AND period_number = 12 AND fiscal_year_id = $1`, [W.fiscalYearA])).toBe("AL003");
      });
    });

    it("allows the status, the lock time and the locker to change, and reopening", async () => {
      await inContext(app, asOwnerA, async () => {
        await lockPeriod(app, 12);
        await app.query("UPDATE fiscal_period SET locked_by_id = NULL WHERE company_id = app_tenant_id() AND period_number = 12");
        await app.query("UPDATE fiscal_period SET status = 'OPEN', locked_at = NULL, locked_by_id = NULL WHERE company_id = app_tenant_id() AND period_number = 12");
        const december = await one<{ status: string }>(app, "SELECT status::text AS status FROM fiscal_period WHERE company_id = app_tenant_id() AND period_number = 12");
        expect(december.status).toBe("OPEN");
      });
    });

    it("keeps the status and the lock time consistent (23514)", async () => {
      await inContext(app, asOwnerA, async () => {
        expect(await attempt(app, "UPDATE fiscal_period SET status = 'LOCKED' WHERE company_id = app_tenant_id() AND period_number = 12")).toBe("23514");
        expect(await attempt(app, "UPDATE fiscal_period SET locked_at = now() WHERE company_id = app_tenant_id() AND period_number = 12")).toBe("23514");
      });
    });

    it("refuses periods that overlap in the same company (23P01)", async () => {
      await inContext(app, asOwnerA, async () => {
        const insertInto2026 = (number: number, start: string, end: string) =>
          app.query(
            `INSERT INTO fiscal_period (id, company_id, fiscal_year_id, period_number, start_date, end_date)
             VALUES (gen_random_uuid(), app_tenant_id(), $1, $2, $3::date, $4::date)`,
            [W.fiscalYearA, number, start, end],
          );
        expect(await attempt(app, () => insertInto2026(13, "2026-03-10", "2026-03-20"))).toBe("23P01");
        expect(await attempt(app, () => insertInto2026(13, "2026-12-31", "2026-12-31"))).toBe("23P01"); // one day shared with December
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Fiscal years
// ---------------------------------------------------------------------------------------------------------

describe("fiscal years", () => {
  it("T21 rejects closing the fiscal year while periods are open (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, "UPDATE fiscal_year SET status = 'CLOSED', closed_at = now() WHERE company_id = app_tenant_id()")).toBe("AL003");
      await lockPeriod(app, 1); // one locked period is not enough
      expect(await attempt(app, "UPDATE fiscal_year SET status = 'CLOSED', closed_at = now() WHERE company_id = app_tenant_id()")).toBe("AL003");
    });
  });

  it("closes a fiscal year once every period is locked", async () => {
    await inContext(app, asOwnerA, async () => {
      await lockYear(app, W.fiscalYearA);
      expect((await app.query(CLOSE_YEAR, [W.fiscalYearA])).rowCount).toBe(1);
      expect((await one<{ status: string }>(app, "SELECT status::text AS status FROM fiscal_year WHERE id = $1", [W.fiscalYearA])).status).toBe("CLOSED");
    });
  });

  it("rejects closing a year whose periods do not cover all of it (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      const year = await newYear(app, 2027, 11); // January to November: December is missing
      await lockYear(app, year);
      expect(await attempt(app, CLOSE_YEAR, [year])).toBe("AL003");
      await app.query(
        `INSERT INTO fiscal_period (id, company_id, fiscal_year_id, period_number, start_date, end_date, status, locked_at)
         VALUES (gen_random_uuid(), app_tenant_id(), $1, 12, '2027-12-01', '2027-12-31', 'LOCKED', now())`,
        [year],
      );
      expect((await app.query(CLOSE_YEAR, [year])).rowCount).toBe(1); // complete and locked: it closes
    });
  });

  it("rejects closing a year when a period in the middle was deleted (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      const year = await newYear(app, 2027);
      await lockYear(app, year);
      await app.query("DELETE FROM fiscal_period WHERE company_id = app_tenant_id() AND fiscal_year_id = $1 AND period_number = 6", [year]);
      expect(await attempt(app, CLOSE_YEAR, [year])).toBe("AL003");
    });
  });

  it("keeps the dates of a fiscal year (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, "UPDATE fiscal_year SET end_date = '2026-12-30' WHERE id = $1", [W.fiscalYearA])).toBe("AL003");
      expect(await attempt(app, "UPDATE fiscal_year SET start_date = '2026-01-02' WHERE id = $1", [W.fiscalYearA])).toBe("AL003");
      expect((await app.query("UPDATE fiscal_year SET closed_by_id = NULL WHERE id = $1", [W.fiscalYearA])).rowCount).toBe(1); // other columns are free
    });
  });

  it("freezes the periods of a closed fiscal year (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      const year = await newYear(app, 2027);
      await lockYear(app, year);
      await app.query(CLOSE_YEAR, [year]);
      const reopenPeriod = "UPDATE fiscal_period SET status = 'OPEN', locked_at = NULL, locked_by_id = NULL WHERE company_id = app_tenant_id() AND fiscal_year_id = $1 AND period_number = 5";
      expect(await attempt(app, reopenPeriod, [year])).toBe("AL003");
      // reopening the year first lets the period move again
      await app.query("UPDATE fiscal_year SET status = 'OPEN', closed_at = NULL, closed_by_id = NULL WHERE id = $1", [year]);
      expect((await app.query(reopenPeriod, [year])).rowCount).toBe(1);
    });
  });

  it("refuses to delete the periods of a closed fiscal year, or the year itself (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      const year = await newYear(app, 2027);
      await lockYear(app, year);
      await app.query(CLOSE_YEAR, [year]);
      expect(await attempt(app, "DELETE FROM fiscal_period WHERE company_id = app_tenant_id() AND fiscal_year_id = $1", [year])).toBe("AL003");
      expect(await attempt(app, "DELETE FROM fiscal_year WHERE id = $1", [year])).toBe("AL003");
    });
  });

  it("deletes an open fiscal year with its periods when nothing was posted", async () => {
    await inContext(app, asOwnerA, async () => {
      const year = await newYear(app, 2027);
      expect((await app.query("DELETE FROM fiscal_period WHERE company_id = app_tenant_id() AND fiscal_year_id = $1", [year])).rowCount).toBe(12);
      expect((await app.query("DELETE FROM fiscal_year WHERE id = $1", [year])).rowCount).toBe(1);
    });
  });

  it("refuses a period that sticks out of its fiscal year (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      const year = await newYear(app, 2027, 11);
      const insertPeriod12 = (start: string, end: string) =>
        app.query(
          `INSERT INTO fiscal_period (id, company_id, fiscal_year_id, period_number, start_date, end_date)
           VALUES (gen_random_uuid(), app_tenant_id(), $1, 12, $2::date, $3::date)`,
          [year, start, end],
        );
      expect(await attempt(app, () => insertPeriod12("2027-12-01", "2028-01-31"))).toBe("AL003"); // ends after the year
      expect(await attempt(app, () => insertPeriod12("2026-12-15", "2027-01-31"))).toBe("AL003"); // starts before the year
      expect((await insertPeriod12("2027-12-01", "2027-12-31")).rowCount).toBe(1); // inside: accepted
    });
  });

  it("refuses to add a period to a closed fiscal year (AL003)", async () => {
    await inContext(app, asOwnerA, async () => {
      const year = await newYear(app, 2027);
      await lockYear(app, year);
      await app.query(CLOSE_YEAR, [year]);
      const code = await attempt(app, () =>
        app.query(
          `INSERT INTO fiscal_period (id, company_id, fiscal_year_id, period_number, start_date, end_date)
           VALUES (gen_random_uuid(), app_tenant_id(), $1, 13, '2027-06-10', '2027-06-20')`,
          [year],
        ),
      );
      expect(code).toBe("AL003");
    });
  });

  it("refuses fiscal years that overlap in the same company (23P01)", async () => {
    await inContext(app, asOwnerA, async () => {
      const insertYear = (start: string, end: string) =>
        app.query("INSERT INTO fiscal_year (id, company_id, start_date, end_date) VALUES (gen_random_uuid(), app_tenant_id(), $1::date, $2::date)", [start, end]);
      expect(await attempt(app, () => insertYear("2026-07-01", "2027-06-30"))).toBe("23P01");
      expect(await attempt(app, () => insertYear("2026-12-31", "2027-12-30"))).toBe("23P01"); // one day shared
      expect((await insertYear("2027-01-01", "2027-12-31")).rowCount).toBe(1); // the next year is fine
    });
  });

  it("requires a sensible year length and a closing date for a closed year (23514)", async () => {
    await inContext(app, asOwnerA, async () => {
      const insertYear = (start: string, end: string) =>
        app.query("INSERT INTO fiscal_year (id, company_id, start_date, end_date) VALUES (gen_random_uuid(), app_tenant_id(), $1::date, $2::date)", [start, end]);
      expect(await attempt(app, () => insertYear("2027-01-01", "2027-01-01"))).toBe("23514"); // ends the day it starts
      expect(await attempt(app, () => insertYear("2027-01-01", "2028-01-07"))).toBe("23514"); // 372 days: more than 53 weeks
      expect((await insertYear("2027-01-01", "2028-01-06")).rowCount).toBe(1); // 371 days: a 53-week year
      await lockYear(app, W.fiscalYearA);
      expect(await attempt(app, "UPDATE fiscal_year SET status = 'CLOSED' WHERE id = $1", [W.fiscalYearA])).toBe("23514"); // no closing date
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Tax rates
// ---------------------------------------------------------------------------------------------------------

describe("tax rates", () => {
  const insertRate = (rate: string, from: string, to: string | null = null) =>
    app.query("INSERT INTO tax_rate (id, company_id, tax_id, rate, effective_from, effective_to) VALUES (gen_random_uuid(), app_tenant_id(), $1, $2, $3::date, $4::date)", [W.gst, rate, from, to]);
  const END_CURRENT_RATE = "UPDATE tax_rate SET effective_to = '2026-12-31' WHERE tax_id = $1 AND effective_to IS NULL";

  it("T22 rejects an overlapping tax rate (23P01)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, () => insertRate("0.06", "2026-01-01"))).toBe("23P01");
    });
  });

  it("accepts a successor rate once the previous one has an end date", async () => {
    await inContext(app, asOwnerA, async () => {
      expect((await app.query(END_CURRENT_RATE, [W.gst])).rowCount).toBe(1);
      expect((await insertRate("0.06", "2027-01-01")).rowCount).toBe(1);
    });
  });

  it("treats the end date of a rate as inclusive (23P01)", async () => {
    await inContext(app, asOwnerA, async () => {
      await app.query(END_CURRENT_RATE, [W.gst]);
      expect(await attempt(app, () => insertRate("0.06", "2026-12-31"))).toBe("23P01");
      expect((await insertRate("0.06", "2027-01-01", "2027-12-31")).rowCount).toBe(1);
    });
  });

  it("rejects a rate whose range ends before it starts (23514)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, () => insertRate("0.06", "2030-01-01", "2029-12-31"))).toBe("23514");
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------------------------------------

describe("account guard", () => {
  it("freezes the type, subtype and system key of an account once it has postings (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const account = await newAccount(app, "ASSET", "CURRENT_ASSET");
      // free to change while the account is unused
      await app.query("UPDATE account SET type = 'EXPENSE', subtype = 'OPERATING_EXPENSE' WHERE id = $1", [account]);
      await app.query("UPDATE account SET type = 'ASSET', subtype = 'CURRENT_ASSET' WHERE id = $1", [account]);
      await post(app, {
        date: "2026-02-10",
        lines: [
          [account, 100, 0],
          [W.capital, 0, 100],
        ],
      });
      expect(await attempt(app, "UPDATE account SET type = 'EXPENSE', subtype = 'OPERATING_EXPENSE' WHERE id = $1", [account])).toBe("AL005");
      expect(await attempt(app, "UPDATE account SET subtype = 'FIXED_ASSET' WHERE id = $1", [account])).toBe("AL005");
      expect(await attempt(app, "UPDATE account SET system_key = 'UNDEPOSITED_FUNDS' WHERE id = $1", [account])).toBe("AL005");
      // everything else can still be edited
      expect((await app.query("UPDATE account SET name_fr = 'Renommé', gifi_code = '1001', description = 'ok' WHERE id = $1", [account])).rowCount).toBe(1);
    });
  });

  it("refuses to delete a system account (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, "DELETE FROM account WHERE id = $1", [W.receivable])).toBe("AL005");
      expect(await attempt(app, "DELETE FROM account WHERE id = $1", [W.undeposited])).toBe("AL005");
      const unused = await newAccount(app, "EXPENSE", "OPERATING_EXPENSE");
      expect((await app.query("DELETE FROM account WHERE id = $1", [unused])).rowCount).toBe(1); // an ordinary unused account goes
    });
  });

  it("refuses to delete an account that has postings (23503)", async () => {
    await inContext(app, asOwnerA, async () => {
      const account = await newAccount(app, "ASSET", "CURRENT_ASSET");
      await post(app, {
        date: "2026-02-10",
        lines: [
          [account, 100, 0],
          [W.capital, 0, 100],
        ],
      });
      expect(await attempt(app, "DELETE FROM account WHERE id = $1", [account])).toBe("23503");
    });
  });

  it("refuses to deactivate a system account (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, "UPDATE account SET is_active = false WHERE id = $1", [W.receivable])).toBe("AL005");
      expect(await attempt(app, "UPDATE account SET is_active = false WHERE id = $1", [W.undeposited])).toBe("AL005");
      const ordinary = await newAccount(app, "EXPENSE", "OPERATING_EXPENSE");
      expect((await app.query("UPDATE account SET is_active = false WHERE id = $1", [ordinary])).rowCount).toBe(1);
    });
  });

  it("requires a parent account of the same type (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const child = await newAccount(app, "ASSET", "CURRENT_ASSET", W.bank); // same type: accepted
      expect(await attempt(app, () => newAccount(app, "EXPENSE", "OPERATING_EXPENSE", W.bank))).toBe("AL005"); // an expense under an asset
      expect(await attempt(app, "UPDATE account SET parent_id = $2 WHERE id = $1", [child, W.sales])).toBe("AL005"); // moved under revenue
      expect(await attempt(app, () => newAccount(app, "ASSET", "CURRENT_ASSET", W.bankB))).toBe("AL005"); // a parent of another company
      expect(await attempt(app, () => newAccount(app, "ASSET", "CURRENT_ASSET", randomUUID()))).toBe("AL005"); // a parent that does not exist
    });
  });

  it("refuses a cycle in the account hierarchy (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const top = await newAccount(app, "ASSET", "CURRENT_ASSET");
      const middle = await newAccount(app, "ASSET", "CURRENT_ASSET", top);
      const bottom = await newAccount(app, "ASSET", "CURRENT_ASSET", middle);
      expect(await attempt(app, "UPDATE account SET parent_id = $2 WHERE id = $1", [top, bottom])).toBe("AL005"); // three levels
      expect(await attempt(app, "UPDATE account SET parent_id = $2 WHERE id = $1", [top, middle])).toBe("AL005"); // two levels
      expect(await attempt(app, "UPDATE account SET parent_id = $1 WHERE id = $1", [top])).toBe("AL005"); // its own parent
      expect((await app.query("UPDATE account SET parent_id = $2 WHERE id = $1", [bottom, top])).rowCount).toBe(1); // a move without a cycle
    });
  });

  it("refuses to move an account to another company (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const account = await newAccount(app, "ASSET", "CURRENT_ASSET");
      expect(await attempt(app, "UPDATE account SET company_id = $2 WHERE id = $1", [account, W.companyB])).toBe("AL005");
    });
  });

  it("keeps the subtype consistent with the type, the code unique, and a single control account of each kind", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, () => newAccount(app, "ASSET", "OPERATING_EXPENSE"))).toBe("23514"); // an expense subtype on an asset
      expect(await attempt(app, () => newAccount(app, "ASSET", "ACCOUNTS_RECEIVABLE"))).toBe("23514"); // a second receivables account
      expect(await attempt(app, "UPDATE account SET code = '1000' WHERE id = $1", [W.expenses])).toBe("23505"); // the bank's code
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Uniqueness and consistency of entries and lines
// ---------------------------------------------------------------------------------------------------------

describe("numbering and line consistency", () => {
  it("rejects a second entry with the same number in a company, even from a later transaction (23505)", async () => {
    const number = nextNumber();
    await inContext(app, asOwnerA, () => post(app, { no: number, date: "2026-02-10", lines: bankCapital(100) }), { commit: true });
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, () => openEntry(app, "2026-02-11", { no: number }))).toBe("23505");
      await post(app, { date: "2026-02-11", lines: bankCapital(100) }); // another number is accepted
    });
  });

  it("numbers entries per company: the same number is accepted in another company", async () => {
    const number = nextNumber();
    await inContext(app, asOwnerA, () => post(app, { no: number, date: "2026-02-10", lines: bankCapital(100) }), { commit: true });
    await inContext(app, asOwnerB, async () => {
      const other = await newAccount(app, "ASSET", "CURRENT_ASSET");
      const id = await post(app, {
        no: number,
        date: "2026-02-10",
        lines: [
          [W.bankB, 100, 0],
          [other, 0, 100],
        ],
      });
      await app.query("SET CONSTRAINTS ALL IMMEDIATE");
      expect(await lineCount(app, id)).toBe(2);
    });
  });

  it("requires a positive entry number (23514)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, () => openEntry(app, "2026-02-10", { no: 0 }))).toBe("23514");
      expect(await attempt(app, () => openEntry(app, "2026-02-10", { no: -5 }))).toBe("23514");
    });
  });

  it("rejects two lines with the same number in an entry (23505)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-10");
      await line(app, id, 1, W.bank, { debit: 100 });
      expect(await attempt(app, () => line(app, id, 1, W.capital, { credit: 100 }))).toBe("23505");
      await line(app, id, 2, W.capital, { credit: 100 });
    });
  });

  it("allows the same line number in two different entries", async () => {
    await inContext(app, asOwnerA, async () => {
      const first = await post(app, { date: "2026-02-10", lines: bankCapital(100) });
      const second = await post(app, { date: "2026-02-10", lines: bankCapital(200) });
      expect(await lineCount(app, first)).toBe(2);
      expect(await lineCount(app, second)).toBe(2);
    });
  });

  it("rejects a line whose date differs from the date of its entry (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-10");
      const insertLine = (no: number, account: string, debit: number, credit: number, date: string) =>
        app.query(
          `INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, entry_date)
           VALUES (gen_random_uuid(), app_tenant_id(), $1, $2, $3, $4, $5, $6::date)`,
          [id, no, account, debit, credit, date],
        );
      expect(await attempt(app, () => insertLine(1, W.bank, 100, 0, "2026-02-11"))).toBe("AL005");
      expect((await insertLine(1, W.bank, 100, 0, "2026-02-10")).rowCount).toBe(1);
      await insertLine(2, W.capital, 0, 100, "2026-02-10");
    });
  });

  it("rejects a line on an inactive account (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const account = await newAccount(app, "ASSET", "CURRENT_ASSET");
      const id = await openEntry(app, "2026-02-10");
      await line(app, id, 1, account, { debit: 100 }); // active: accepted
      await app.query("UPDATE account SET is_active = false WHERE id = $1", [account]);
      expect(await attempt(app, () => line(app, id, 2, account, { debit: 100 }))).toBe("AL005");
      await line(app, id, 2, W.capital, { credit: 100 });
    });
  });

  it("still lets a reversal post on an account that was deactivated since", async () => {
    await inContext(app, asOwnerA, async () => {
      const account = await newAccount(app, "ASSET", "CURRENT_ASSET");
      const original = await post(app, {
        date: "2026-02-10",
        lines: [
          [account, 100, 0],
          [W.capital, 0, 100],
        ],
      });
      await app.query("UPDATE account SET is_active = false WHERE id = $1", [account]);
      const reversal = await post(app, {
        date: "2026-02-11",
        source: "REVERSAL",
        reverses: original,
        lines: [
          [account, 0, 100],
          [W.capital, 100, 0],
        ],
      });
      await app.query("SET CONSTRAINTS ALL IMMEDIATE");
      expect(await lineCount(app, reversal)).toBe(2);
    });
  });

  it("rejects a line on an account of another company (AL005), and the composite foreign key would too (23503)", async () => {
    await inContext(app, asOwnerA, async () => {
      const id = await openEntry(app, "2026-02-10");
      await line(app, id, 1, W.bank, { debit: 100 });
      // As the application role, the other company's account is invisible: the validation trigger finds nothing.
      expect(await attempt(app, () => line(app, id, 2, W.bankB, { credit: 100 }))).toBe("AL005");
      await line(app, id, 2, W.capital, { credit: 100 });
    });

    // Independently of the trigger: with the validation trigger disabled (until the rollback), the
    // (company_id, account_id) foreign key alone still refuses an account of another company.
    await inContext(db, asOwnerA, async () => {
      await db.query("ALTER TABLE journal_line DISABLE TRIGGER journal_line_validate");
      const id = await openEntry(db, "2026-02-10");
      await line(db, id, 1, W.bank, { debit: 100 });
      expect(await attempt(db, () => line(db, id, 2, W.bankB, { credit: 100 }))).toBe("23503");
      await line(db, id, 2, W.capital, { credit: 100 });
    });
    const trigger = await one<{ enabled: string }>(db, "SELECT tgenabled::text AS enabled FROM pg_trigger WHERE tgname = 'journal_line_validate'");
    expect(trigger.enabled).toBe("O"); // the ALTER was rolled back with its transaction
  });

  it("rejects a line that names a contact of another company (23503)", async () => {
    await inContext(app, asOwnerB, async () => {
      const other = await newAccount(app, "ASSET", "CURRENT_ASSET");
      const id = await openEntry(app, "2026-02-10");
      await line(app, id, 1, W.bankB, { debit: 100 });
      // company A's customer does not exist in company B
      expect(await attempt(app, () => line(app, id, 2, other, { credit: 100, contact: W.customer }))).toBe("23503");
      await line(app, id, 2, other, { credit: 100 });
    });
  });

  it("rejects a line for an entry that does not exist (AL005)", async () => {
    await inContext(app, asOwnerA, async () => {
      const insertLine = (entryId: string) =>
        app.query(
          `INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, entry_date)
           VALUES (gen_random_uuid(), app_tenant_id(), $1, 1, $2, 100, 0, '2026-02-10')`,
          [entryId, W.bank],
        );
      expect(await attempt(app, () => insertLine(randomUUID()))).toBe("AL005");
      const id = await openEntry(app, "2026-02-10");
      expect((await insertLine(id)).rowCount).toBe(1); // the same insert for an existing entry is accepted
      await line(app, id, 2, W.capital, { credit: 100 });
    });
  });

  it("does not let a read-only member post an entry", async () => {
    await inContext(app, asReader, async () => {
      // The period lock (SELECT ... FOR SHARE) goes through the UPDATE policy, so a read-only member does not even
      // see the period: the validation trigger answers AL003 before the INSERT policy could answer 42501.
      expect(await attempt(app, () => entry(app, { id: randomUUID(), no: nextNumber(), date: "2026-02-10" }))).toBe("AL003");
    });
    await inContext(app, asOwnerA, async () => {
      expect(await lineCount(app, await post(app, { date: "2026-02-10", lines: bankCapital(100) }))).toBe(2); // a writer can
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Owner role of a company (own_1.sql, own_3.sql)
// ---------------------------------------------------------------------------------------------------------

describe("owner role of a company (own_1, own_3)", () => {
  it("own_1 refuses to demote the last owner of a company (AL009)", async () => {
    const code = await sqlstate(() =>
      inContext(app, asOwnerA, async () => {
        await app.query("UPDATE membership SET role = 'ACCOUNTANT', updated_at = now() WHERE user_id = $1", [W.userOwnerA]);
      }),
    );
    expect(code).toBe("AL009");
  });

  it("own_1b lets an owner step down once another owner exists", async () => {
    await inContext(app, asOwnerA, async () => {
      await app.query("UPDATE membership SET role = 'OWNER', updated_at = now() WHERE user_id = $1", [W.userAccountant]);
      const stepDown = await app.query("UPDATE membership SET role = 'ACCOUNTANT', updated_at = now() WHERE user_id = $1", [W.userOwnerA]);
      expect(stepDown.rowCount).toBe(1);
    });
  });

  it("own_3 does not let a read-only member promote themself", async () => {
    await inContext(app, asReader, async () => {
      const promoted = await app.query("UPDATE membership SET role = 'ACCOUNTANT', updated_at = now() WHERE user_id = $1", [W.userReader]);
      expect(promoted.rowCount).toBe(0); // row level security: the row is not theirs to write
      const role = await one<{ role: string }>(app, "SELECT role::text AS role FROM membership WHERE user_id = $1 AND company_id = $2", [W.userReader, W.companyA]);
      expect(role.role).toBe("READ_ONLY");
    });
  });

  it("own_3b lets the owner change the role of a member", async () => {
    await inContext(app, asOwnerA, async () => {
      const promoted = await app.query("UPDATE membership SET role = 'ACCOUNTANT', updated_at = now() WHERE user_id = $1", [W.userReader]);
      expect(promoted.rowCount).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Concurrency (two connections)
// ---------------------------------------------------------------------------------------------------------

describe("concurrency", () => {
  it("C1 locking a period waits for the entry in progress, then the period refuses new entries", async () => {
    // November belongs to this test alone: it is reopened at the end.
    const writer = await openSession();
    const locker = await openSession();
    try {
      await post(writer, { date: "2026-11-10", lines: bankCapital(100) }); // holds the period until COMMIT
      const lockerPid = (await one<{ pid: number }>(locker, "SELECT pg_backend_pid() AS pid")).pid;
      const locking = locker.query(
        "UPDATE fiscal_period SET status = 'LOCKED', locked_at = now() WHERE company_id = app_tenant_id() AND period_number = 11 AND fiscal_year_id = $1",
        [W.fiscalYearA],
      );
      locking.catch(() => undefined); // surfaced by the await below; no unhandled rejection if the test fails first
      await waitUntil(() => isWaitingForLock(lockerPid), "the period lock to wait for the entry");
      await writer.query("SET CONSTRAINTS ALL IMMEDIATE");
      await writer.query("COMMIT");
      expect((await locking).rowCount).toBe(1);
      await locker.query("COMMIT");

      expect(await sqlstate(() => inContext(app, asOwnerA, () => openEntry(app, "2026-11-12")))).toBe("AL003");
      const kept = await one<{ n: number }>(
        db,
        "SELECT count(*)::int AS n FROM journal_entry e JOIN fiscal_period p ON p.id = e.fiscal_period_id WHERE p.period_number = 11 AND e.company_id = $1",
        [W.companyA],
      );
      expect(kept.n).toBe(1); // the entry that was in progress was kept
    } finally {
      await closeSession(writer);
      await closeSession(locker);
      await db.query("UPDATE fiscal_period SET status = 'OPEN', locked_at = NULL, locked_by_id = NULL WHERE period_number = 11 AND company_id = $1", [W.companyA]);
    }
  });

  it("C2 two transactions that take the same entry number: the second is refused once the first commits", async () => {
    const first = await openSession();
    const second = await openSession();
    const number = nextNumber();
    try {
      await post(first, { no: number, date: "2026-02-10", lines: bankCapital(100) });
      const secondPid = (await one<{ pid: number }>(second, "SELECT pg_backend_pid() AS pid")).pid;
      const secondResult = sqlstate(() => openEntry(second, "2026-02-10", { no: number }));
      await waitUntil(() => isWaitingForLock(secondPid), "the second entry to wait for the first");
      await first.query("SET CONSTRAINTS ALL IMMEDIATE");
      await first.query("COMMIT");
      expect(await secondResult).toBe("23505");
      const kept = await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM journal_entry WHERE entry_number = $1 AND company_id = $2", [number, W.companyA]);
      expect(kept.n).toBe(1);
    } finally {
      await closeSession(first);
      await closeSession(second);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// Properties (fast-check; each run touches the database, hence the small number of runs)
// ---------------------------------------------------------------------------------------------------------

describe("properties", () => {
  const RUNS = { numRuns: 20 };
  const accounts = [W.bank, W.undeposited, W.capital, W.sales, W.expenses];
  const arbAccount = fc.constantFrom(...accounts);
  const arbContact = fc.constantFrom<string | null>(null, W.customer, W.otherCustomer, W.supplier);
  const arbCents = fc.integer({ min: 1, max: 1_000_000_000 });
  type Side = { account: string; cents: number; contact: string | null }[];
  const arbSide = fc.array(fc.record({ account: arbAccount, cents: arbCents, contact: arbContact }), { minLength: 1, maxLength: 4 });
  const pad = (n: number): string => String(n).padStart(2, "0");
  const arbDate = fc.record({ month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) }).map(({ month, day }) => `2026-${pad(month)}-${pad(day)}`);

  /** Debits and credits of an entry: the shorter side gets one extra line so that both totals are equal. */
  function balance(debits: Side, credits: Side, balancing: string): PostLine[] {
    const sum = (side: Side): number => side.reduce((total, l) => total + l.cents, 0);
    const lines: PostLine[] = [
      ...debits.map((l): PostLine => [l.account, l.cents, 0, { contact: l.contact }]),
      ...credits.map((l): PostLine => [l.account, 0, l.cents, { contact: l.contact }]),
    ];
    const gap = sum(debits) - sum(credits);
    if (gap > 0) lines.push([balancing, 0, gap]);
    if (gap < 0) lines.push([balancing, -gap, 0]);
    return lines;
  }
  const arbEntry = fc
    .record({ date: arbDate, debits: arbSide, credits: arbSide, balancing: arbAccount })
    .map(({ date, debits, credits, balancing }) => ({ date, lines: balance(debits, credits, balancing) }));

  const totals = (): Promise<{ debits: string; credits: string }> =>
    one(app, "SELECT coalesce(sum(debit_cents), 0)::text AS debits, coalesce(sum(credit_cents), 0)::text AS credits FROM journal_line WHERE company_id = app_tenant_id()");
  /** Balance of every account and contact (zero balances left out: an account that was never used has no row). */
  const balances = async (): Promise<string> =>
    JSON.stringify(
      (
        await app.query(
          `SELECT account_id, contact_id, sum(debit_cents - credit_cents)::text AS net FROM journal_line WHERE company_id = app_tenant_id()
            GROUP BY account_id, contact_id HAVING sum(debit_cents - credit_cents) <> 0 ORDER BY account_id, contact_id`,
        )
      ).rows,
    );

  it("P1 any sequence of balanced entries leaves the sum of debits equal to the sum of credits", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbEntry, { minLength: 1, maxLength: 6 }), async (entries) => {
        await inContext(app, asOwnerA, async () => {
          const before = await totals();
          expect(before.debits).toBe(before.credits);
          let debited = 0;
          for (const e of entries) {
            await post(app, e);
            debited += e.lines.reduce((total, l) => total + l[1], 0);
          }
          await app.query("SET CONSTRAINTS ALL IMMEDIATE");
          const after = await totals();
          expect(after.debits).toBe(after.credits);
          expect(BigInt(after.debits) - BigInt(before.debits)).toBe(BigInt(debited));
        });
      }),
      RUNS,
    );
  });

  it("P2 an entry that is unbalanced by any amount, or has fewer than two lines, is always refused", async () => {
    await fc.assert(
      fc.asyncProperty(arbEntry, fc.integer({ min: 1, max: 1_000_000 }), fc.constantFrom("unbalanced", "single line", "no lines"), async (e, delta, kind) => {
        const lines: readonly PostLine[] = kind === "unbalanced" ? [...e.lines, [W.expenses, delta, 0]] : kind === "single line" ? e.lines.slice(0, 1) : [];
        const code = await sqlstate(() => inContext(app, asOwnerA, () => post(app, { date: e.date, lines })));
        expect(code).toBe(kind === "unbalanced" ? "AL001" : "AL002");
      }),
      RUNS,
    );
  });

  it("P3 an entry followed by its reversal leaves every account and contact balance unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(arbEntry, fc.integer({ min: 0, max: 27 }), async (e, later) => {
        await inContext(app, asOwnerA, async () => {
          const before = await balances();
          const original = await post(app, e);
          const day = Math.min(28, Number(e.date.slice(8)) + later);
          const reversalDate = `${e.date.slice(0, 8)}${pad(day)}`;
          await post(app, { date: reversalDate, source: "REVERSAL", reverses: original, lines: e.lines.map((l): PostLine => [l[0], l[2], l[1], l[3]]) });
          await app.query("SET CONSTRAINTS ALL IMMEDIATE");
          expect(await balances()).toBe(before);
        });
      }),
      RUNS,
    );
  });

  it("P11 an entry is accepted exactly when its date falls in an open period, after any sequence of locks and reopenings", async () => {
    const arbOperations = fc.array(fc.record({ period: fc.integer({ min: 1, max: 12 }), lock: fc.boolean() }), { maxLength: 12 });
    await fc.assert(
      fc.asyncProperty(arbOperations, arbDate, async (operations, date) => {
        await inContext(app, asOwnerA, async () => {
          const locked = new Set<number>();
          for (const { period, lock } of operations) {
            if (lock) {
              await lockPeriod(app, period);
              locked.add(period);
            } else {
              await app.query(
                "UPDATE fiscal_period SET status = 'OPEN', locked_at = NULL, locked_by_id = NULL WHERE company_id = app_tenant_id() AND fiscal_year_id = $1 AND period_number = $2",
                [W.fiscalYearA, period],
              );
              locked.delete(period);
            }
          }
          const month = Number(date.slice(5, 7)); // the periods of the fixtures are the calendar months
          expect(await attempt(app, () => post(app, { date, lines: bankCapital(100) }))).toBe(locked.has(month) ? "AL003" : null);
        });
      }),
      RUNS,
    );
  });

  it("P14 whatever rate ranges are proposed, at most one rate applies on any date", async () => {
    const dayOf = (offset: number): string => new Date(Date.UTC(2030, 0, 1 + offset)).toISOString().slice(0, 10);
    const arbRange = fc.record({ from: fc.integer({ min: 0, max: 60 }), length: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }) });
    await fc.assert(
      fc.asyncProperty(fc.array(arbRange, { minLength: 1, maxLength: 8 }), async (ranges) => {
        await inContext(app, asOwnerA, async () => {
          const taxId = randomUUID();
          await app.query("INSERT INTO tax (id, company_id, code, name_fr, name_en, payable_account_id) VALUES ($1, app_tenant_id(), 'PROP', 'Taxe de test', 'Test tax', $2)", [taxId, W.gstPayable]);
          const accepted: { from: number; to: number }[] = [];
          for (const range of ranges) {
            const to = range.length === null ? Number.POSITIVE_INFINITY : range.from + range.length;
            const sameStart = accepted.some((a) => a.from === range.from);
            const overlaps = accepted.some((a) => a.from <= to && range.from <= a.to);
            const code = await attempt(
              app,
              "INSERT INTO tax_rate (id, company_id, tax_id, rate, effective_from, effective_to) VALUES (gen_random_uuid(), app_tenant_id(), $1, 0.05, $2::date, $3::date)",
              [taxId, dayOf(range.from), range.length === null ? null : dayOf(to)],
            );
            // the same start date is also a duplicate of the (tax, start date) key, which is checked first
            expect(code).toBe(sameStart ? "23505" : overlaps ? "23P01" : null);
            if (code === null) accepted.push({ from: range.from, to });
          }
          const busiest = await one<{ n: number }>(
            app,
            `SELECT coalesce(max(c), 0)::int AS n FROM (
               SELECT d, count(*) AS c FROM generate_series($2::date, $2::date + 120, interval '1 day') d
                 JOIN tax_rate r ON r.tax_id = $1 AND d::date BETWEEN r.effective_from AND coalesce(r.effective_to, DATE '9999-12-31') GROUP BY d) x`,
            [taxId, dayOf(0)],
          );
          expect(busiest.n).toBeLessThanOrEqual(1);
        });
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Performance guard
// ---------------------------------------------------------------------------------------------------------

describe("performance", () => {
  // Check available indexes, not a cost-based plan on a tiny fixture: PostgreSQL may reasonably choose
  // another index and filter by id. The bulk insert test below separately guards execution performance.
  it("keeps an index for each lookup of the entry checks and of the reports", async () => {
    const lookups = [
      ["journal_line", "entry_id"],
      ["journal_entry", "id"],
      ["journal_entry", "entry_number"],
      ["journal_entry", "entry_date"],
      ["journal_entry", "reverses_entry_id"],
      ["journal_line", "account_id"],
      ["journal_line", "contact_id"],
      ["journal_line", "tax_id"],
      ["fiscal_period", "start_date"],
    ];
    const { rows } = await db.query<{ table_name: string; columns: string[] }>(`
      SELECT t.relname AS table_name, array_agg(a.attname::text ORDER BY k.ordinality) AS columns
        FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_am am ON am.oid = idx.relam
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE n.nspname = 'public' AND t.relname IN ('journal_entry', 'journal_line', 'fiscal_period')
         AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND am.amname = 'btree'
         AND k.ordinality <= i.indnkeyatts
       GROUP BY t.relname, i.indexrelid
    `);
    for (const [table, column] of lookups) {
      expect(rows.some(row => row.table_name === table && row.columns[0] === "company_id" && row.columns[1] === column),
        `${table}: usable index starting with company_id, ${column}`).toBe(true);
    }
  });

  it("validates 2000 two-line entries inserted in one transaction without quadratic slowdown", { timeout: 120_000 }, async () => {
    const count = 2000;
    const base = entryCounter;
    entryCounter += count;
    const salt = randomUUID();
    await inContext(app, asOwnerA, async () => {
      const started = performance.now();
      await app.query(
        `INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, created_by_id)
         SELECT md5($2 || g::text)::uuid, app_tenant_id(), $1::bigint + g, fp.start_date + (g % 28), fp.id, 'MANUAL', app_current_user_id()
           FROM generate_series(1, $3::int) g
           JOIN fiscal_period fp ON fp.company_id = app_tenant_id() AND fp.fiscal_year_id = $4 AND fp.period_number = 1`,
        [base, salt, count, W.fiscalYearA],
      );
      await app.query(
        `INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, entry_date)
         SELECT gen_random_uuid(), e.company_id, e.id, s.n, CASE s.n WHEN 1 THEN $2::uuid ELSE $3::uuid END,
                CASE s.n WHEN 1 THEN e.entry_number - $1::bigint ELSE 0 END, CASE s.n WHEN 1 THEN 0 ELSE e.entry_number - $1::bigint END, e.entry_date
           FROM journal_entry e CROSS JOIN (VALUES (1), (2)) s(n)
          WHERE e.company_id = app_tenant_id() AND e.entry_number > $1::bigint AND e.entry_number <= $1::bigint + $4::int`,
        [base, W.bank, W.capital, count],
      );
      await app.query("SET CONSTRAINTS ALL IMMEDIATE"); // the balance and completeness checks of 2000 entries
      const elapsed = performance.now() - started;
      const stored = await one<{ entries: number; lines: number; debits: string; credits: string }>(
        app,
        `SELECT (SELECT count(*)::int FROM journal_entry WHERE entry_number > $1::bigint AND entry_number <= $1::bigint + $2::int) AS entries,
                count(*)::int AS lines, sum(debit_cents)::text AS debits, sum(credit_cents)::text AS credits
           FROM journal_line l JOIN journal_entry e ON e.company_id = l.company_id AND e.id = l.entry_id
          WHERE e.entry_number > $1::bigint AND e.entry_number <= $1::bigint + $2::int`,
        [base, count],
      );
      expect(stored.entries).toBe(count);
      expect(stored.lines).toBe(count * 2);
      expect(stored.debits).toBe(stored.credits);
      expect(elapsed).toBeLessThan(40_000); // loose on purpose: it catches a missing index, not a slow runner
    });
  });
});
