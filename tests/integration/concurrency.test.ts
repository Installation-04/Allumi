import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { owner } from "./helpers";
import { appClient, asOwnerA, asOwnerB, entry, inContext, line, seedWorld, setContext, sqlstate, W } from "./world";
import type { Context } from "./world";

/**
 * Concurrency rules of the database, with two (or more) real connections: a lock that waits for the COMMIT of a
 * writer, a check that sees what the other transaction committed, a row lock that serializes counters.
 *
 * The phase 1 scenarios (conc1/conc2, race_v2_*, own_*) ran as shell scripts with sleeps. Here nothing relies on
 * a sleep: each session is a BEGIN on its own connection, the second statement is started without being awaited,
 * and the test polls pg_stat_activity (wait_event_type = 'Lock', and pg_blocking_pids names the first session)
 * until the second session is really blocked. Only then does the first one commit, so the order of events is the
 * one the scenario describes, and a lock that stopped waiting would make the test fail instead of pass by luck.
 *
 * These tests commit (they need two connections to see each other), so each one builds its own state with fresh
 * identifiers and uses its own fiscal period; they can run in any order.
 */

let db: pg.Client; // table owner (superuser): fixtures, verifications, and the observer of pg_stat_activity
let app: pg.Client; // the restricted application role, for committed fixtures and verifications

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
// Sessions and waiting
// ---------------------------------------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(what: string, condition: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

type Session = { client: pg.Client; pid: number };

/** A connection inside an open transaction, in the given context. */
async function openSession(ctx: Context, connect: () => Promise<pg.Client>): Promise<Session> {
  const client = await connect();
  client.on("error", () => undefined); // a backend terminated by the cleanup is not a failure of the test
  const row = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0];
  if (!row) throw new Error("no backend pid");
  await client.query("BEGIN");
  await setContext(client, ctx);
  return { client, pid: row.pid };
}

/** Opens the sessions, runs `fn`, and always puts everything back (a blocked session is terminated, not awaited). */
async function withSessions<T>(contexts: Context[], fn: (sessions: Session[]) => Promise<T>, connect: () => Promise<pg.Client> = appClient): Promise<T> {
  const sessions: Session[] = [];
  try {
    for (const ctx of contexts) sessions.push(await openSession(ctx, connect));
    return await fn(sessions);
  } finally {
    for (const session of sessions) {
      const rolledBack = await Promise.race([session.client.query("ROLLBACK").then(() => true, () => false), sleep(2000).then(() => false)]);
      if (!rolledBack) await db.query("SELECT pg_terminate_backend($1)", [session.pid]);
      await session.client.end().catch(() => undefined);
    }
  }
}

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("missing session");
  return value;
};
const withPair = <T>(a: Context, b: Context, fn: (first: Session, second: Session) => Promise<T>, connect?: () => Promise<pg.Client>): Promise<T> =>
  withSessions([a, b], (s) => fn(must(s[0]), must(s[1])), connect);
const withTrio = <T>(a: Context, b: Context, c: Context, fn: (first: Session, second: Session, third: Session) => Promise<T>): Promise<T> =>
  withSessions([a, b, c], (s) => fn(must(s[0]), must(s[1]), must(s[2])));

/** Waits until `session` is blocked on a heavyweight lock (and, when given, held by `by`), as pg_stat_activity shows it. */
async function waitUntilBlocked(session: Session, by?: Session): Promise<void> {
  await waitFor(`backend ${session.pid} to wait for a lock${by ? ` held by backend ${by.pid}` : ""}`, async () => {
    const { rows } = await db.query<{ wait_event_type: string | null; blockers: number[] }>(
      "SELECT wait_event_type, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid = $1",
      [session.pid],
    );
    const row = rows[0];
    return row?.wait_event_type === "Lock" && (by === undefined || row.blockers.includes(by.pid));
  });
}

/** Runs `work` without waiting for it. `settled()` says whether it has finished; `result` is its outcome. */
function start<T>(work: () => Promise<T>): { result: Promise<T>; settled: () => boolean } {
  let done = false;
  const result = work();
  void result.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  return { result, settled: () => done };
}

/**
 * Starts `acquire` on every session at once: they queue on the same row lock and complete one at a time. Each time
 * one completes, checks that all the others are really blocked, lets `whileLocked` act under the lock, then commits it.
 * Returns the values in the order the lock was obtained.
 */
async function serialize<T>(sessions: Session[], acquire: (session: Session) => Promise<T>, whileLocked: (session: Session, value: T) => Promise<void> = async () => undefined): Promise<T[]> {
  const pending = new Map<Session, Promise<{ session: Session; value: T }>>();
  for (const session of sessions) {
    const started = acquire(session).then((value) => ({ session, value }));
    started.catch(() => undefined); // reported where it is awaited
    pending.set(session, started);
  }
  const order: T[] = [];
  while (pending.size > 0) {
    const { session, value } = await Promise.race(pending.values());
    pending.delete(session);
    for (const other of pending.keys()) await waitUntilBlocked(other);
    await whileLocked(session, value);
    await session.client.query("COMMIT");
    order.push(value);
  }
  return order;
}

// ---------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;

async function one<T extends Row>(client: pg.Client, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await client.query<T>(sql, params)).rows[0];
  if (!row) throw new Error(`no row returned by: ${sql}`);
  return row;
}
const int = async (client: pg.Client, sql: string, params: unknown[] = []): Promise<number> => (await one<{ n: number }>(client, sql, params)).n;

/** Committed fixtures: runs `fn` as the owner of company A and commits (the deferred checks fire first). */
const commitAsOwnerA = <T>(fn: () => Promise<T>): Promise<T> => inContext(app, asOwnerA, fn, { commit: true });

// Entry numbers and document numbers are never reused.
let entryCounter = 1000;
const nextNumber = (): number => ++entryCounter;
let documentCounter = 0;

type EntrySpec = { id?: string; no: number; date: string };
/** A complete balanced manual entry (header and two lines) in the current transaction of `client`. */
async function postBalanced(client: pg.Client, spec: EntrySpec, account: string = W.bank, counterpart: string = W.capital): Promise<string> {
  const id = spec.id ?? randomUUID();
  await entry(client, { id, no: spec.no, date: spec.date });
  await line(client, id, 1, account, { debit: 1000 });
  await line(client, id, 2, counterpart, { credit: 1000 });
  return id;
}

const LOCK_PERIOD =
  "UPDATE fiscal_period SET status = 'LOCKED', locked_at = now(), locked_by_id = app_current_user_id() WHERE company_id = app_tenant_id() AND period_number = $1";

/** A draft invoice dated `date` with one line per amount (code GST+QST) and exact taxes (t.invoice_draft). */
async function draftInvoice(client: pg.Client, date: string, amounts: number[]): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO sales_document (id, company_id, kind, contact_id, issue_date, posting_date, due_date, tax_rounding, created_by_id, updated_at)
     VALUES ($1, app_tenant_id(), 'INVOICE', $2, $3::date, $3::date, $3::date + 30, 'PER_LINE', app_current_user_id(), now())`,
    [id, W.customer, date],
  );
  for (const [index, cents] of amounts.entries()) {
    await client.query(
      `INSERT INTO sales_document_line (id, company_id, document_id, position, description, quantity, unit_price, amount_cents, account_id, tax_code_id)
       VALUES (gen_random_uuid(), app_tenant_id(), $1, $2, 'Service', 1, $3::bigint / 100.0, $3::bigint, $4, $5)`,
      [id, index + 1, cents, W.sales, W.taxCodeStandard],
    );
  }
  await computeTaxes(client, id);
  return id;
}

/** (Re)writes the tax rows of a draft from its lines, with per-line rounding. */
async function computeTaxes(client: pg.Client, id: string): Promise<void> {
  await client.query("DELETE FROM sales_document_tax WHERE document_id = $1", [id]);
  await client.query(
    `INSERT INTO sales_document_tax (id, company_id, document_id, tax_id, rate, base_cents, amount_cents)
     SELECT gen_random_uuid(), app_tenant_id(), $1, t.id, t.rate, sum(l.amount_cents), sum(round(l.amount_cents * t.rate))
       FROM sales_document_line l, (VALUES ($2::uuid, 0.05::numeric), ($3::uuid, 0.09975::numeric)) t(id, rate)
      WHERE l.document_id = $1
      GROUP BY t.id, t.rate`,
    [id, W.gst, W.qst],
  );
}

/** Posts a draft with the totals it holds now, and its entry (t.invoice_post). Returns the total. */
async function postDraft(client: pg.Client, id: string): Promise<number> {
  const doc = await one<{ posting_date: string; contact_id: string }>(client, "SELECT posting_date::text AS posting_date, contact_id FROM sales_document WHERE id = $1", [id]);
  const subtotal = await int(client, "SELECT coalesce(sum(amount_cents), 0)::int AS n FROM sales_document_line WHERE document_id = $1", [id]);
  const gst = await int(client, "SELECT coalesce(sum(amount_cents), 0)::int AS n FROM sales_document_tax WHERE document_id = $1 AND tax_id = $2", [id, W.gst]);
  const qst = await int(client, "SELECT coalesce(sum(amount_cents), 0)::int AS n FROM sales_document_tax WHERE document_id = $1 AND tax_id = $2", [id, W.qst]);
  const total = subtotal + gst + qst;
  const entryId = randomUUID();
  await entry(client, { id: entryId, no: nextNumber(), date: doc.posting_date, source: "SALES_DOCUMENT", sourceId: id });
  await line(client, entryId, 1, W.receivable, { debit: total, contact: doc.contact_id });
  await line(client, entryId, 2, W.sales, { credit: subtotal });
  await line(client, entryId, 3, W.gstPayable, { credit: gst, tax: W.gst, box: "COLLECTED" });
  await line(client, entryId, 4, W.qstPayable, { credit: qst, tax: W.qst, box: "COLLECTED" });
  await client.query(
    `UPDATE sales_document SET status = 'POSTED', number = $2, journal_entry_id = $3,
            billing_snapshot = '{"name":"client"}', issuer_snapshot = '{"name":"Atelier Exemple inc."}',
            subtotal_cents = $4::bigint, tax_total_cents = $5::bigint, total_cents = $6::bigint,
            posted_at = now(), posted_by_id = app_current_user_id(), updated_at = now()
      WHERE id = $1`,
    [id, `F-C-${String(++documentCounter).padStart(4, "0")}`, entryId, subtotal, gst + qst, total],
  );
  return total;
}

/** A posted receipt of `cents` into the bank account (t.receipt). Returns the payment id. */
async function postReceipt(client: pg.Client, date: string, cents: number): Promise<string> {
  const id = randomUUID();
  const entryId = randomUUID();
  await entry(client, { id: entryId, no: nextNumber(), date, source: "PAYMENT", sourceId: id });
  await line(client, entryId, 1, W.bank, { debit: cents });
  await line(client, entryId, 2, W.receivable, { credit: cents, contact: W.customer });
  await client.query(
    `INSERT INTO payment (id, company_id, direction, ledger, contact_id, payment_date, amount_cents, account_id, method, journal_entry_id, created_by_id, updated_at)
     VALUES ($1, app_tenant_id(), 'RECEIVED', 'RECEIVABLE', $2, $3::date, $4, $5, 'EFT', $6, app_current_user_id(), now())`,
    [id, W.customer, date, cents, W.bank, entryId],
  );
  return id;
}

const ALLOCATE = `INSERT INTO payment_allocation (id, company_id, payment_id, sales_document_id, amount_cents, applied_date, created_by_id)
                  VALUES (gen_random_uuid(), app_tenant_id(), $1, $2, $3, '2026-06-06', app_current_user_id())`;
const OPEN_BALANCE_OF_DOCUMENT = "SELECT sales_document_open_cents(app_tenant_id(), $1)::int AS n";
const OPEN_BALANCE_OF_PAYMENT = "SELECT payment_open_cents(app_tenant_id(), $1)::int AS n";

// ---------------------------------------------------------------------------------------------------------
// Fiscal periods and entries
// ---------------------------------------------------------------------------------------------------------

describe("locking a fiscal period while entries are written", () => {
  it("makes the lock wait for the COMMIT of the entry being written, then refuses the next entry (AL003)", async () => {
    const written = randomUUID();
    await withTrio(asOwnerA, asOwnerA, asOwnerA, async (writer, locker, next) => {
      // The writer posts in May and holds a share lock on the period until it commits.
      await postBalanced(writer.client, { id: written, no: nextNumber(), date: "2026-05-10" });
      const locking = start(() => sqlstate(() => locker.client.query(LOCK_PERIOD, [5])));
      await waitUntilBlocked(locker, writer);
      expect(locking.settled()).toBe(false);

      await writer.client.query("COMMIT");
      expect(await locking.result).toBeNull();
      await locker.client.query("COMMIT");

      // The lock is in place: the next entry of May is refused, whoever tries
      expect(await sqlstate(() => postBalanced(next.client, { no: nextNumber(), date: "2026-05-11" }))).toBe("AL003");
    });
    expect((await one<{ status: string }>(db, "SELECT status FROM fiscal_period WHERE company_id = $1 AND period_number = 5", [W.companyA])).status).toBe("LOCKED");
    // the entry that was being written when the lock was requested went through, complete
    expect(await int(db, "SELECT count(*)::int AS n FROM journal_line WHERE entry_id = $1", [written])).toBe(2);
    // positive control: the other periods are still open
    await commitAsOwnerA(() => postBalanced(app, { no: nextNumber(), date: "2026-06-10" }));
  });

  it("makes an entry written while a lock is pending wait for it, then refuses it (AL003)", async () => {
    const no = nextNumber();
    await withTrio(asOwnerA, asOwnerA, asOwnerA, async (locker, writer, other) => {
      expect((await locker.client.query(LOCK_PERIOD, [7])).rowCount).toBe(1);
      const writing = start(() => sqlstate(() => postBalanced(writer.client, { no, date: "2026-07-10" })));
      await waitUntilBlocked(writer, locker);
      expect(writing.settled()).toBe(false);

      // The lock is on one period only: a write in another period does not wait for it
      const elsewhere = start(() => postBalanced(other.client, { no: nextNumber(), date: "2026-08-10" }));
      await waitFor("a write in another period to go through", () => elsewhere.settled());
      await elsewhere.result;

      await locker.client.query("COMMIT");
      expect(await writing.result).toBe("AL003");
      await other.client.query("COMMIT");
    });
    expect(await int(db, "SELECT count(*)::int AS n FROM journal_entry WHERE company_id = $1 AND entry_number = $2", [W.companyA, no])).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------------------------------------

describe("simultaneous allocations", () => {
  it("refuses the second of two allocations that together exceed one invoice (AL007)", async () => {
    const { invoice, total, first, second } = await commitAsOwnerA(async () => {
      const invoiceId = await draftInvoice(app, "2026-06-01", [10000]);
      const invoiceTotal = await postDraft(app, invoiceId);
      return { invoice: invoiceId, total: invoiceTotal, first: await postReceipt(app, "2026-06-05", 6000), second: await postReceipt(app, "2026-06-05", 6000) };
    });
    expect(total).toBe(11498);

    await withPair(asOwnerA, asOwnerA, async (s1, s2) => {
      await s1.client.query(ALLOCATE, [first, invoice, 6000]);
      await s1.client.query("SET CONSTRAINTS ALL IMMEDIATE"); // 6000 fits in 11498

      // 6000 more does not fit; the second session must wait for the first one's outcome to know it
      const racing = start(() =>
        sqlstate(async () => {
          await s2.client.query(ALLOCATE, [second, invoice, 6000]);
          await s2.client.query("SET CONSTRAINTS ALL IMMEDIATE");
        }),
      );
      await waitUntilBlocked(s2, s1);
      expect(racing.settled()).toBe(false);
      await s1.client.query("COMMIT");
      expect(await racing.result).toBe("AL007");
    });
    // exactly one allocation stands
    expect(await commitAsOwnerA(() => int(app, OPEN_BALANCE_OF_DOCUMENT, [invoice]))).toBe(total - 6000);
    expect(await int(db, "SELECT count(*)::int AS n FROM payment_allocation WHERE sales_document_id = $1", [invoice])).toBe(1);

    // positive control: what remains of the invoice is accepted
    await commitAsOwnerA(async () => {
      await app.query(ALLOCATE, [second, invoice, total - 6000]);
    });
    expect(await commitAsOwnerA(() => int(app, OPEN_BALANCE_OF_DOCUMENT, [invoice]))).toBe(0);
  });

  it("refuses the second of two allocations that together exceed one payment (AL007)", async () => {
    const { invoices, payment } = await commitAsOwnerA(async () => {
      const first = await draftInvoice(app, "2026-06-02", [10000]);
      await postDraft(app, first);
      const second = await draftInvoice(app, "2026-06-02", [10000]);
      await postDraft(app, second);
      return { invoices: [first, second] as const, payment: await postReceipt(app, "2026-06-05", 6000) };
    });

    await withPair(asOwnerA, asOwnerA, async (s1, s2) => {
      await s1.client.query(ALLOCATE, [payment, invoices[0], 4000]);
      await s1.client.query("SET CONSTRAINTS ALL IMMEDIATE"); // 4000 of 6000

      const racing = start(() =>
        sqlstate(async () => {
          await s2.client.query(ALLOCATE, [payment, invoices[1], 4000]);
          await s2.client.query("SET CONSTRAINTS ALL IMMEDIATE");
        }),
      );
      await waitUntilBlocked(s2, s1);
      expect(racing.settled()).toBe(false);
      await s1.client.query("COMMIT");
      expect(await racing.result).toBe("AL007");
    });
    expect(await commitAsOwnerA(() => int(app, OPEN_BALANCE_OF_PAYMENT, [payment]))).toBe(2000);

    // positive control: what remains of the payment is accepted
    await commitAsOwnerA(async () => {
      await app.query(ALLOCATE, [payment, invoices[1], 2000]);
    });
    expect(await commitAsOwnerA(() => int(app, OPEN_BALANCE_OF_PAYMENT, [payment]))).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Draft lines and posting
// ---------------------------------------------------------------------------------------------------------

describe("deleting a draft line while the document is being posted", () => {
  const DELETE_SECOND_LINE = "DELETE FROM sales_document_line WHERE document_id = $1 AND position = 2";

  it("makes the posting fail on the totals it read before the deletion, and leaves the draft intact (AL006)", async () => {
    const draft = await commitAsOwnerA(() => draftInvoice(app, "2026-06-03", [10000, 5000]));
    await withPair(asOwnerA, asOwnerA, async (deleter, poster) => {
      expect((await deleter.client.query(DELETE_SECOND_LINE, [draft])).rowCount).toBe(1);

      // The poster still sees both lines (the deletion is not committed) and posts 15000 plus taxes;
      // its last statement waits for the deleter, then finds that the totals no longer match.
      const posting = start(() => sqlstate(() => postDraft(poster.client, draft)));
      await waitUntilBlocked(poster, deleter);
      expect(posting.settled()).toBe(false);
      await deleter.client.query("COMMIT");
      expect(await posting.result).toBe("AL006");
    });
    expect(await one(db, "SELECT status::text AS status, number FROM sales_document WHERE id = $1", [draft])).toEqual({ status: "DRAFT", number: null });
    expect(await int(db, "SELECT count(*)::int AS n FROM sales_document_line WHERE document_id = $1", [draft])).toBe(1);
    expect(await int(db, "SELECT count(*)::int AS n FROM journal_entry WHERE source_id = $1", [draft])).toBe(0);

    // positive control: the draft, with its taxes recomputed for the remaining line, posts normally
    await commitAsOwnerA(async () => {
      await computeTaxes(app, draft);
      expect(await postDraft(app, draft)).toBe(11498);
    });
    expect((await one<{ status: string }>(db, "SELECT status::text AS status FROM sales_document WHERE id = $1", [draft])).status).toBe("POSTED");
  });

  it("makes the deletion wait for a posting in progress, then refuses it (AL006)", async () => {
    const draft = await commitAsOwnerA(() => draftInvoice(app, "2026-06-04", [10000, 5000]));
    await withPair(asOwnerA, asOwnerA, async (poster, deleter) => {
      expect(await postDraft(poster.client, draft)).toBe(17247);

      const deleting = start(() => sqlstate(() => deleter.client.query(DELETE_SECOND_LINE, [draft])));
      await waitUntilBlocked(deleter, poster);
      expect(deleting.settled()).toBe(false);
      await poster.client.query("COMMIT");
      expect(await deleting.result).toBe("AL006");
    });
    // the posted document is whole: both lines, totals that match them
    expect(await one(db, "SELECT status::text AS status, subtotal_cents::int AS subtotal FROM sales_document WHERE id = $1", [draft])).toEqual({ status: "POSTED", subtotal: 15000 });
    expect(await int(db, "SELECT sum(amount_cents)::int AS n FROM sales_document_line WHERE document_id = $1", [draft])).toBe(15000);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Entry numbers
// ---------------------------------------------------------------------------------------------------------

describe("entry numbers", () => {
  const entriesNumbered = (companyId: string, no: number): Promise<{ id: string }[]> =>
    db.query<{ id: string }>("SELECT id FROM journal_entry WHERE company_id = $1 AND entry_number = $2", [companyId, no]).then((result) => result.rows);

  it("lets exactly one of two simultaneous postings with the same number win (23505)", async () => {
    const no = nextNumber();
    const winner = randomUUID();
    const loser = randomUUID();
    await withPair(asOwnerA, asOwnerA, async (s1, s2) => {
      await postBalanced(s1.client, { id: winner, no, date: "2026-08-12" });
      // the same number: the second insert waits for the first transaction to say whether the number is taken
      const racing = start(() => sqlstate(() => postBalanced(s2.client, { id: loser, no, date: "2026-08-13" })));
      await waitUntilBlocked(s2, s1);
      expect(racing.settled()).toBe(false);
      await s1.client.query("COMMIT");
      expect(await racing.result).toBe("23505");
    });
    expect(await entriesNumbered(W.companyA, no)).toEqual([{ id: winner }]);
    expect(await int(db, "SELECT count(*)::int AS n FROM journal_line WHERE entry_id = $1", [winner])).toBe(2);
  });

  it("gives the number to the second posting when the first one rolls back", async () => {
    const no = nextNumber();
    const abandoned = randomUUID();
    const taker = randomUUID();
    await withPair(asOwnerA, asOwnerA, async (s1, s2) => {
      await postBalanced(s1.client, { id: abandoned, no, date: "2026-08-14" });
      const racing = start(() => sqlstate(() => postBalanced(s2.client, { id: taker, no, date: "2026-08-15" })));
      await waitUntilBlocked(s2, s1);
      await s1.client.query("ROLLBACK");
      expect(await racing.result).toBeNull();
      await s2.client.query("COMMIT");
    });
    expect(await entriesNumbered(W.companyA, no)).toEqual([{ id: taker }]);
  });

  it("does not make different numbers, or the same number in two companies, wait for each other", async () => {
    const no = nextNumber();
    await withTrio(asOwnerA, asOwnerA, asOwnerB, async (s1, sameCompany, otherCompany) => {
      await postBalanced(s1.client, { no, date: "2026-08-16" });
      // another number in the same company
      const next = start(() => postBalanced(sameCompany.client, { no: nextNumber(), date: "2026-08-16" }));
      await waitFor("another number to be written while the first is open", () => next.settled());
      await next.result;
      // the same number in another company (numbers are per company); company B has a single account, used on both sides
      const sameNumber = start(() => postBalanced(otherCompany.client, { no, date: "2026-08-16" }, W.bankB, W.bankB));
      await waitFor("the same number to be written in another company", () => sameNumber.settled());
      await sameNumber.result;
      for (const session of [s1, sameCompany, otherCompany]) await session.client.query("COMMIT");
    });
    expect(await int(db, "SELECT count(*)::int AS n FROM journal_entry WHERE entry_number = $1", [no])).toBe(2);
  });
});

describe("number_sequence row locking", () => {
  const NEXT_NUMBER = "UPDATE number_sequence SET next_value = next_value + 1 WHERE company_id = $1 AND key = $2::sequence_key RETURNING next_value - 1 AS allocated";
  const allocate = async (session: Session, companyId: string, key: string): Promise<number> => {
    const row = (await session.client.query<{ allocated: string }>(NEXT_NUMBER, [companyId, key])).rows[0];
    if (!row) throw new Error("the sequence row does not exist");
    return Number(row.allocated);
  };
  const nextValue = async (companyId: string, key: string): Promise<number> =>
    Number((await one<{ next_value: string }>(db, "SELECT next_value FROM number_sequence WHERE company_id = $1 AND key = $2::sequence_key", [companyId, key])).next_value);

  it("gives N simultaneous transactions the numbers 1..N", async () => {
    const N = 6;
    await db.query("INSERT INTO number_sequence (company_id, key, next_value) VALUES ($1, 'JOURNAL_ENTRY', 1)", [W.companyB]);
    await withSessions(
      Array.from({ length: N }, () => asOwnerB),
      async (sessions) => {
        // all the updates are in flight together; each one waits for the row lock held by the one before
        const obtained = await serialize(sessions, (session) => allocate(session, W.companyB, "JOURNAL_ENTRY"));
        expect(obtained).toEqual([1, 2, 3, 4, 5, 6]);
      },
    );
    expect(await nextValue(W.companyB, "JOURNAL_ENTRY")).toBe(N + 1);
  });

  it("leaves no gap when an allocation rolls back", async () => {
    await db.query("INSERT INTO number_sequence (company_id, key, next_value) VALUES ($1, 'INVOICE', 1)", [W.companyB]);
    await withPair(asOwnerB, asOwnerB, async (s1, s2) => {
      expect(await allocate(s1, W.companyB, "INVOICE")).toBe(1);
      const racing = start(() => allocate(s2, W.companyB, "INVOICE"));
      await waitUntilBlocked(s2, s1);
      await s1.client.query("ROLLBACK"); // the number 1 was not used
      expect(await racing.result).toBe(1);
      await s2.client.query("COMMIT");
    });
    expect(await nextValue(W.companyB, "INVOICE")).toBe(2);
  });

  it("numbers simultaneous postings consecutively, each entry with its own number", async () => {
    const N = 4;
    const first = 7000;
    await db.query("INSERT INTO number_sequence (company_id, key, next_value) VALUES ($1, 'JOURNAL_ENTRY', $2)", [W.companyA, first]);
    await withSessions(
      Array.from({ length: N }, () => asOwnerA),
      async (sessions) => {
        const obtained = await serialize(
          sessions,
          (session) => allocate(session, W.companyA, "JOURNAL_ENTRY"),
          async (session, no) => {
            await postBalanced(session.client, { no, date: "2026-09-15" });
          },
        );
        expect(obtained).toEqual([7000, 7001, 7002, 7003]);
      },
    );
    const numbers = (await db.query<{ entry_number: string }>("SELECT entry_number FROM journal_entry WHERE company_id = $1 AND entry_number >= $2 ORDER BY entry_number", [W.companyA, first])).rows.map((row) => Number(row.entry_number));
    expect(numbers).toEqual([7000, 7001, 7002, 7003]);
    expect(await nextValue(W.companyA, "JOURNAL_ENTRY")).toBe(first + N);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Members and administrators
// ---------------------------------------------------------------------------------------------------------

describe("demoting the last two owners or administrators", () => {
  it("refuses the second of two simultaneous demotions of the two owners of a company (AL009)", async () => {
    const company = randomUUID();
    const x = randomUUID();
    const y = randomUUID();
    for (const [id, email] of [
      [x, "proprio-x@exemple.test"],
      [y, "proprio-y@exemple.test"],
    ] as const) {
      await db.query("INSERT INTO app_user (id, email, display_name, updated_at) VALUES ($1, $2, 'Propriétaire', now())", [id, email]);
    }
    await db.query("INSERT INTO company (id, name, updated_at) VALUES ($1, 'Troisième Exemple inc.', now())", [company]);
    for (const id of [x, y]) {
      await db.query("INSERT INTO membership (id, company_id, user_id, role, updated_at) VALUES (gen_random_uuid(), $1, $2, 'OWNER', now())", [company, id]);
    }
    const demote = "UPDATE membership SET role = 'ACCOUNTANT', updated_at = now() WHERE company_id = $1 AND user_id = $2";
    const owners = async (): Promise<string[]> =>
      (await db.query<{ user_id: string }>("SELECT user_id FROM membership WHERE company_id = $1 AND role = 'OWNER'", [company])).rows.map((row) => row.user_id);

    await withPair({ userId: x, companyId: company }, { userId: y, companyId: company }, async (sx, sy) => {
      await sx.client.query(demote, [company, x]);
      await sx.client.query("SET CONSTRAINTS ALL IMMEDIATE"); // y is still an owner: accepted

      // y demotes themself too: the statement waits for the lock on the company that x holds until the COMMIT,
      // then the check sees that x is gone and that nobody would be left
      const racing = start(() =>
        sqlstate(async () => {
          await sy.client.query(demote, [company, y]);
          await sy.client.query("SET CONSTRAINTS ALL IMMEDIATE");
        }),
      );
      await waitUntilBlocked(sy, sx);
      expect(racing.settled()).toBe(false);
      await sx.client.query("COMMIT");
      expect(await racing.result).toBe("AL009");
    });
    expect(await owners()).toEqual([y]);

    // positive control: one demotion at a time is fine while another owner stays (x is made owner again by y)
    await inContext(app, { userId: y, companyId: company }, () => app.query("UPDATE membership SET role = 'OWNER', updated_at = now() WHERE company_id = $1 AND user_id = $2", [company, x]), { commit: true });
    await inContext(app, { userId: x, companyId: company }, () => app.query(demote, [company, x]), { commit: true });
    expect(await owners()).toEqual([y]);
  });

  it("refuses the second of two simultaneous demotions of the two instance administrators (AL009)", async () => {
    // The administrator of the world is demoted for the duration of the test so that exactly two remain; restored below.
    const p = randomUUID();
    const q = randomUUID();
    for (const [id, email] of [
      [p, "admin-p@exemple.test"],
      [q, "admin-q@exemple.test"],
    ] as const) {
      await db.query("INSERT INTO app_user (id, email, display_name, is_instance_admin, updated_at) VALUES ($1, $2, 'Administrateur', true, now())", [id, email]);
    }
    await db.query("UPDATE app_user SET is_instance_admin = false WHERE id = $1", [W.userOwnerA]);
    try {
      const demote = "UPDATE app_user SET is_instance_admin = false WHERE id = $1";
      await withPair(
        {},
        {},
        async (sp, sq) => {
          await sp.client.query(demote, [p]);
          await sp.client.query("SET CONSTRAINTS ALL IMMEDIATE"); // q is still an administrator: accepted, and p holds the advisory lock

          const racing = start(() =>
            sqlstate(async () => {
              await sq.client.query(demote, [q]);
              await sq.client.query("SET CONSTRAINTS ALL IMMEDIATE");
            }),
          );
          await waitUntilBlocked(sq, sp);
          expect(racing.settled()).toBe(false);
          await sp.client.query("COMMIT");
          expect(await racing.result).toBe("AL009");
        },
        owner, // administrators are changed by the table owner: the application role has no privilege on that column
      );
      const admins = (await db.query<{ id: string }>("SELECT id FROM app_user WHERE is_instance_admin AND disabled_at IS NULL")).rows.map((row) => row.id);
      expect(admins).toEqual([q]);
    } finally {
      await db.query("UPDATE app_user SET is_instance_admin = true WHERE id = $1", [W.userOwnerA]);
    }
  });
});
