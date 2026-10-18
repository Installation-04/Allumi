import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { owner } from "./helpers";
import { appClient, asAccountant, asOwnerA, asOwnerB, asReader, entry, inContext, line, seedWorld, setContext, sqlstate, W } from "./world";

/**
 * Access control, audit trail and pre-session lookups, enforced by the database itself. Ported from the phase 1
 * SQL cases T23..T33 and T50..T58 (smoke_app.sql, run as the restricted role `allumi_app`) and the owner-level
 * scripts own_1 and own_3, plus the rules of the plan that had no SQL case yet (company selector, identity tables,
 * audit append-only, secrets and noise, last administrator...).
 *
 * isolation.test.ts and auth.test.ts exercise part of the same rules through the services (Prisma, message
 * patterns); here the rules are asserted on the database, with the exact SQLSTATE of each refusal. Every group has
 * a positive control, so a test cannot pass just because everything fails.
 *
 * Each test runs in a transaction that is rolled back (`inContext` fires the deferred checks first, like a COMMIT).
 * The few fixtures that must be visible to other connections are committed once, in beforeAll.
 */

let db: pg.Client; // table owner (superuser): fixtures and the triggers that back up the privileges
let app: pg.Client; // the restricted application role, like the real application
let anon: pg.Client; // same role, but it is never given a context (the state of a request before the session is resolved)

// Fixtures added to the shared world (committed in beforeAll).
const F = {
  contactB: "00000000-0000-7000-8000-00000000cb01",
  userDisabled: "00000000-0000-7000-8000-000000000005",
} as const;
const TOKEN = { valid: "ab".repeat(32), expired: "cd".repeat(32), revoked: "ef".repeat(32), accepted: "12".repeat(32), unknown: "34".repeat(32) } as const;
const SESSION = { ownerA: "a1".repeat(32), reader: "b2".repeat(32), ownerB: "c3".repeat(32) } as const;
const RESET = { ownerA: "d4".repeat(32), reader: "e5".repeat(32), unknown: "f6".repeat(32) } as const;

beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO contact (id, company_id, is_customer, display_name, updated_at) VALUES ($1, $2, true, 'Client de B', now())", [F.contactB, W.companyB]);
  // A user with no membership who is disabled: the login lookup must say so.
  await db.query("INSERT INTO app_user (id, email, display_name, disabled_at, updated_at) VALUES ($1, 'desactive@exemple.test', 'Désactivé', now(), now())", [F.userDisabled]);
  await db.query("INSERT INTO user_credential (user_id, password_hash, password_changed_at, updated_at) VALUES ($1, 'argon2-placeholder', now(), now())", [F.userDisabled]);
  // Invitations that are no longer pending.
  await db.query(
    `INSERT INTO invitation (id, company_id, email, role, token_hash, expires_at, accepted_at, revoked_at, created_by_id) VALUES
       (gen_random_uuid(), $1, 'expiree@exemple.test', 'READ_ONLY', $2, now() - interval '1 day', NULL, NULL, $5),
       (gen_random_uuid(), $1, 'revoquee@exemple.test', 'READ_ONLY', $3, now() + interval '7 days', NULL, now(), $5),
       (gen_random_uuid(), $1, 'acceptee@exemple.test', 'READ_ONLY', $4, now() + interval '7 days', now(), NULL, $5)`,
    [W.companyA, TOKEN.expired, TOKEN.revoked, TOKEN.accepted, W.userOwnerA],
  );
  // Sessions, recovery codes and reset tokens of different users: each user may see only their own.
  for (const [id, userId] of [
    [SESSION.ownerA, W.userOwnerA],
    [SESSION.reader, W.userReader],
    [SESSION.ownerB, W.userOwnerB],
  ] as const) {
    await db.query("INSERT INTO session (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [id, userId]);
  }
  for (const userId of [W.userOwnerA, W.userReader, W.userOwnerB]) {
    await db.query("INSERT INTO user_recovery_code (id, user_id, code_hash) VALUES (gen_random_uuid(), $1, 'hash-de-test')", [userId]);
  }
  for (const [id, userId] of [
    [RESET.ownerA, W.userOwnerA],
    [RESET.reader, W.userReader],
  ] as const) {
    await db.query("INSERT INTO password_reset_token (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [id, userId]);
  }
  app = await appClient();
  anon = await appClient();
});
afterAll(async () => {
  await anon.end();
  await app.end();
  await db.end();
});

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;

async function rows<T extends Row>(client: pg.Client, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await client.query<T>(sql, params)).rows;
}

async function one<T extends Row>(client: pg.Client, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await rows<T>(client, sql, params))[0];
  if (!row) throw new Error(`no row returned by: ${sql}`);
  return row;
}

/** Number of rows of `SELECT 1 FROM <from>`: pass "table" or "table WHERE ...". */
async function count(client: pg.Client, from: string, params: unknown[] = []): Promise<number> {
  return (await one<{ n: number }>(client, `SELECT count(*)::int AS n FROM ${from}`, params)).n;
}

/** The SQLSTATE of a statement run inside a savepoint, so that the transaction stays usable. */
async function attempt(client: pg.Client, sql: string, params: unknown[] = []): Promise<string | null> {
  await client.query("SAVEPOINT attempt");
  const code = await sqlstate(() => client.query(sql, params));
  await client.query(code === null ? "RELEASE SAVEPOINT attempt" : "ROLLBACK TO SAVEPOINT attempt");
  return code;
}

const INSERT_CONTACT = "INSERT INTO contact (id, company_id, is_customer, display_name, updated_at) VALUES (gen_random_uuid(), $1, true, $2, now())";

let entryCounter = 100;
/** Posts a complete, balanced manual entry (header and two lines) and returns its id. */
async function postBalanced(client: pg.Client, date = "2026-02-10"): Promise<string> {
  const id = randomUUID();
  await entry(client, { id, no: ++entryCounter, date });
  await line(client, id, 1, W.bank, { debit: 1000 });
  await line(client, id, 2, W.capital, { credit: 1000 });
  return id;
}

/** The same company-scoped tables with rows in the world, for both companies. */
const TENANT_TABLES = ["account", "contact", "fiscal_year", "fiscal_period", "membership", "audit_log"] as const;

// ---------------------------------------------------------------------------------------------------------
// Isolation between companies
// ---------------------------------------------------------------------------------------------------------

describe("isolation between companies", () => {
  it("T23 rows of company B are invisible from company A", async () => {
    await inContext(app, asOwnerA, async () => {
      for (const table of TENANT_TABLES) expect(await count(app, `${table} WHERE company_id = $1`, [W.companyB]), table).toBe(0);
      expect(await count(app, "company WHERE id = $1", [W.companyB])).toBe(0);
      // positive control: company A sees its own rows
      for (const table of TENANT_TABLES) expect(await count(app, `${table} WHERE company_id = $1`, [W.companyA]), table).toBeGreaterThan(0);
    });
    // and the other way round, which also proves the rows of B exist
    await inContext(app, asOwnerB, async () => {
      for (const table of TENANT_TABLES) {
        expect(await count(app, `${table} WHERE company_id = $1`, [W.companyB]), table).toBeGreaterThan(0);
        expect(await count(app, `${table} WHERE company_id = $1`, [W.companyA]), table).toBe(0);
      }
    });
  });

  it("T24 IDOR: a non-member pointing at company B sees nothing", async () => {
    const pointsAtB = { userId: W.userOwnerA, companyId: W.companyB };
    await inContext(app, pointsAtB, async () => {
      for (const table of ["account", "contact", "fiscal_year", "fiscal_period", "tax", "tax_code", "invitation", "audit_log", "journal_entry"]) {
        expect(await count(app, table), table).toBe(0);
      }
      // the effective company is retained only for a member: no tenant, no role, no write right
      expect(await one(app, "SELECT app_tenant_id() AS tenant, app_tenant_role() AS role, app_can_write() AS can_write")).toEqual({ tenant: null, role: null, can_write: false });
      // the user still sees their own memberships and companies, never those of B
      expect(await rows(app, "SELECT company_id, user_id FROM membership")).toEqual([{ company_id: W.companyA, user_id: W.userOwnerA }]);
      expect(await rows(app, "SELECT id FROM company")).toEqual([{ id: W.companyA }]);
    });
    // an identifier that exists nowhere gives the same nothing
    await inContext(app, { userId: W.userOwnerA, companyId: randomUUID() }, async () => {
      expect(await count(app, "account")).toBe(0);
    });
    // positive control: the same user naming their own company sees its data
    await inContext(app, asOwnerA, async () => {
      expect(await count(app, "account")).toBeGreaterThan(0);
      expect(await one(app, "SELECT app_tenant_id() AS tenant, app_tenant_role() AS role, app_can_write() AS can_write")).toEqual({ tenant: W.companyA, role: "OWNER", can_write: true });
    });
  });

  it("T25 IDOR: a non-member cannot write into company B", async () => {
    await inContext(app, { userId: W.userOwnerA, companyId: W.companyB }, async () => {
      expect(await attempt(app, INSERT_CONTACT, [W.companyB, "Intrus"])).toBe("42501");
    });
    await inContext(app, asOwnerA, async () => {
      // a member of A who names company B in the row itself
      expect(await attempt(app, INSERT_CONTACT, [W.companyB, "Intrus"])).toBe("42501");
      // rows of B cannot be changed or deleted: they are not even visible
      expect((await app.query("UPDATE contact SET display_name = 'Pirate' WHERE id = $1", [F.contactB])).rowCount).toBe(0);
      expect((await app.query("DELETE FROM contact WHERE id = $1", [F.contactB])).rowCount).toBe(0);
      // and a row of A cannot be moved to B
      expect(await attempt(app, "UPDATE contact SET company_id = $1 WHERE id = $2", [W.companyB, W.customer])).toBe("42501");
      // positive control: the same insert into the own company succeeds
      expect((await app.query(INSERT_CONTACT, [W.companyA, "Légitime"])).rowCount).toBe(1);
    });
    expect(await count(db, "contact WHERE company_id = $1", [W.companyB])).toBe(1);
    expect((await one<{ display_name: string }>(db, "SELECT display_name FROM contact WHERE id = $1", [F.contactB])).display_name).toBe("Client de B");
  });

  it("T26 no context means no rows (fail-closed)", async () => {
    const tables = ["journal_entry", "account", "company", "app_user", "user_credential", "membership", "contact", "invitation", "audit_log", "session"];
    // a connection that was never given a context...
    for (const table of tables) expect(await count(anon, table), table).toBe(0);
    // ...and a transaction whose context is empty
    await inContext(app, {}, async () => {
      for (const table of tables) expect(await count(app, table), table).toBe(0);
    });
    // positive control: with a context the same tables hold rows (an entry is posted for the journal)
    await inContext(app, asOwnerA, async () => {
      await postBalanced(app);
      for (const table of tables) expect(await count(app, table), table).toBeGreaterThan(0);
    });
  });

  it("T33 a cross-tenant insert does not reveal the other company data", async () => {
    const insertInto = `INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, created_by_id)
                        VALUES (gen_random_uuid(), $1, 33, '1999-01-01', $2, 'MANUAL', app_current_user_id())`;
    const periodOfB = (await one<{ id: string }>(db, "SELECT id FROM fiscal_period WHERE company_id = $1 LIMIT 1", [W.companyB])).id;
    await inContext(app, asOwnerA, async () => {
      const periodOfA = (await one<{ id: string }>(app, "SELECT id FROM fiscal_period LIMIT 1")).id;
      // a period of A, a period of B that really exists and an identifier that exists nowhere: the same answer,
      // so the error is no oracle on what company B holds
      for (const period of [periodOfA, periodOfB, randomUUID()]) expect(await attempt(app, insertInto, [W.companyB, period])).toBe("AL003");
      // positive control: an entry in the own company goes through
      await postBalanced(app);
    });
  });

  it("limits the company selector to the memberships of the user", async () => {
    const companiesOf = async (ctx: { userId: string }): Promise<unknown[]> =>
      inContext(app, ctx, async () => (await rows<{ id: string }>(app, "SELECT id FROM company ORDER BY id")).map((r) => r.id));
    expect(await companiesOf({ userId: W.userOwnerA })).toEqual([W.companyA]);
    expect(await companiesOf({ userId: W.userReader })).toEqual([W.companyA]);
    expect(await companiesOf({ userId: W.userOwnerB })).toEqual([W.companyB]);
    // a user with no membership, and an identifier that is no user at all: nothing
    expect(await companiesOf({ userId: F.userDisabled })).toEqual([]);
    expect(await companiesOf({ userId: randomUUID() })).toEqual([]);
    // identity alone opens no company data
    await inContext(app, { userId: W.userOwnerA }, async () => {
      expect(await count(app, "account")).toBe(0);
      expect(await rows(app, "SELECT user_id FROM membership")).toEqual([{ user_id: W.userOwnerA }]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------------------

describe("roles", () => {
  it("T27 a read-only member can read", async () => {
    const visible = async () => ({
      account: await count(app, "account"),
      contact: await count(app, "contact"),
      periods: await count(app, "fiscal_period"),
      members: await count(app, "membership"),
    });
    const asReaderSees = await inContext(app, asReader, async () => {
      expect(await one(app, "SELECT app_tenant_role() AS role, app_can_write() AS can_write")).toEqual({ role: "READ_ONLY", can_write: false });
      return visible();
    });
    // positive control: there is something to read, and the owner reads exactly the same company data
    const asOwnerSees = await inContext(app, asOwnerA, visible);
    expect(asOwnerSees).toEqual({ account: 11, contact: 3, periods: 12, members: 3 });
    expect(asReaderSees).toEqual(asOwnerSees);
  });

  it("T28 a read-only member cannot write", async () => {
    await inContext(app, asReader, async () => {
      expect(await attempt(app, INSERT_CONTACT, [W.companyA, "Pas permis"])).toBe("42501");
      // changes and deletions find no row to act on
      expect((await app.query("UPDATE contact SET display_name = 'Modifié' WHERE id = $1", [W.customer])).rowCount).toBe(0);
      expect((await app.query("DELETE FROM contact WHERE id = $1", [W.customer])).rowCount).toBe(0);
      expect((await app.query("UPDATE fiscal_period SET status = 'LOCKED', locked_at = now() WHERE period_number = 3")).rowCount).toBe(0);
      expect((await one<{ display_name: string }>(app, "SELECT display_name FROM contact WHERE id = $1", [W.customer])).display_name).toBe("Client Fictif");
      // positive control: the same statements succeed for an accountant, so the refusal comes from the role
      await setContext(app, asAccountant);
      expect((await app.query(INSERT_CONTACT, [W.companyA, "Permis"])).rowCount).toBe(1);
      expect((await app.query("UPDATE contact SET display_name = 'Modifié' WHERE id = $1", [W.customer])).rowCount).toBe(1);
    });
  });

  it("T29 an accountant can write but cannot manage members", async () => {
    await inContext(app, asAccountant, async () => {
      expect((await app.query(INSERT_CONTACT, [W.companyA, "Client du comptable"])).rowCount).toBe(1);
      // no promotion (the row is out of reach of the update), no new member, no removal
      expect((await app.query("UPDATE membership SET role = 'OWNER', updated_at = now() WHERE user_id = $1", [W.userAccountant])).rowCount).toBe(0);
      expect(await attempt(app, "INSERT INTO membership (id, company_id, user_id, role, updated_at) VALUES (gen_random_uuid(), $1, $2, 'READ_ONLY', now())", [W.companyA, W.userOwnerB])).toBe("42501");
      expect((await app.query("DELETE FROM membership WHERE user_id = $1", [W.userReader])).rowCount).toBe(0);
      expect(await rows(app, "SELECT user_id, role FROM membership ORDER BY user_id")).toEqual([
        { user_id: W.userOwnerA, role: "OWNER" },
        { user_id: W.userReader, role: "READ_ONLY" },
        { user_id: W.userAccountant, role: "ACCOUNTANT" },
      ]);
      // positive control: the owner does manage members
      await setContext(app, asOwnerA);
      expect((await app.query("UPDATE membership SET role = 'OWNER', updated_at = now() WHERE user_id = $1", [W.userAccountant])).rowCount).toBe(1);
      expect((await one<{ role: string }>(app, "SELECT role FROM membership WHERE user_id = $1", [W.userAccountant])).role).toBe("OWNER");
    });
  });

  it("OWN3 a read-only member cannot promote themselves", async () => {
    await inContext(app, asReader, async () => {
      expect((await app.query("UPDATE membership SET role = 'ACCOUNTANT', updated_at = now() WHERE user_id = $1", [W.userReader])).rowCount).toBe(0);
      expect((await one<{ role: string }>(app, "SELECT role FROM membership WHERE user_id = $1", [W.userReader])).role).toBe("READ_ONLY");
    });
  });

  it("only the owner changes the settings of the company", async () => {
    const rename = (name: string) => app.query("UPDATE company SET name = $1, updated_at = now() WHERE id = $2", [name, W.companyA]);
    await inContext(app, asAccountant, async () => expect((await rename("Renommée")).rowCount).toBe(0));
    await inContext(app, asReader, async () => expect((await rename("Renommée")).rowCount).toBe(0));
    await inContext(app, asOwnerA, async () => {
      expect((await rename("Renommée")).rowCount).toBe(1);
      expect((await one<{ name: string }>(app, "SELECT name FROM company WHERE id = $1", [W.companyA])).name).toBe("Renommée");
    });
    expect((await one<{ name: string }>(db, "SELECT name FROM company WHERE id = $1", [W.companyA])).name).toBe("Atelier Exemple inc.");
  });

  it("a disabled user loses access to the company at once", async () => {
    // The table owner disables the user and the checks run as the application role in the same transaction.
    await inContext(db, asAccountant, async () => {
      await db.query("SET LOCAL ROLE allumi_app");
      expect(await count(db, "account")).toBeGreaterThan(0);
      await db.query("RESET ROLE");
      await db.query("UPDATE app_user SET disabled_at = now() WHERE id = $1", [W.userAccountant]);
      await db.query("SET LOCAL ROLE allumi_app");
      expect(await count(db, "account")).toBe(0);
      expect(await one(db, "SELECT app_tenant_id() AS tenant, app_tenant_role() AS role")).toEqual({ tenant: null, role: null });
      expect(await attempt(db, INSERT_CONTACT, [W.companyA, "Désactivé"])).toBe("42501");
      // the other members are not affected
      await setContext(db, asOwnerA);
      expect(await count(db, "account")).toBeGreaterThan(0);
      await db.query("RESET ROLE");
    });
  });
});

describe("members and administrators", () => {
  it("OWN1 a company keeps at least one owner (AL009)", async () => {
    const demote = (): Promise<unknown> => inContext(app, asOwnerA, () => app.query("UPDATE membership SET role = 'ACCOUNTANT', updated_at = now() WHERE user_id = $1", [W.userOwnerA]));
    const remove = (): Promise<unknown> => inContext(app, asOwnerA, () => app.query("DELETE FROM membership WHERE user_id = $1", [W.userOwnerA]));
    expect(await sqlstate(demote)).toBe("AL009");
    expect(await sqlstate(remove)).toBe("AL009");
    // positive control: with a second owner in place the first can step down...
    expect(
      await sqlstate(() =>
        inContext(app, asOwnerA, async () => {
          await app.query("UPDATE membership SET role = 'OWNER', updated_at = now() WHERE user_id = $1", [W.userAccountant]);
          await app.query("UPDATE membership SET role = 'ACCOUNTANT', updated_at = now() WHERE user_id = $1", [W.userOwnerA]);
        }),
      ),
    ).toBeNull();
    // ...or be removed by that other owner
    expect(
      await sqlstate(() =>
        inContext(app, asOwnerA, async () => {
          await app.query("UPDATE membership SET role = 'OWNER', updated_at = now() WHERE user_id = $1", [W.userAccountant]);
          await setContext(app, asAccountant);
          await app.query("DELETE FROM membership WHERE user_id = $1", [W.userOwnerA]);
        }),
      ),
    ).toBeNull();
  });

  // FIXME(database): membership_owner_check is SECURITY INVOKER, so its "is there still an owner?" query runs under
  // row level security. When an owner deletes their own membership they lose their tenancy at once, the other owner
  // is no longer visible to the check and it raises AL009 although an owner remains (the table owner, who bypasses
  // RLS, and another owner doing the same delete are both accepted). The refusal is on the safe side, but it
  // contradicts the rule it enforces. Remove `.fails` when the check can see every owner of the company.
  it.fails("OWN1 an owner can leave a company that has another owner (FIXME: refused with AL009 under RLS)", async () => {
    await inContext(app, asOwnerA, async () => {
      await app.query("UPDATE membership SET role = 'OWNER', updated_at = now() WHERE user_id = $1", [W.userAccountant]);
      await app.query("DELETE FROM membership WHERE user_id = $1", [W.userOwnerA]);
    });
  });

  it("a membership cannot move to another company or user (AL009, even for the table owner)", async () => {
    const move = (sql: string, params: unknown[]): Promise<unknown> => inContext(db, asOwnerA, () => db.query(sql, params));
    expect(await sqlstate(() => move("UPDATE membership SET company_id = $1 WHERE user_id = $2", [W.companyB, W.userReader]))).toBe("AL009");
    expect(await sqlstate(() => move("UPDATE membership SET user_id = $1 WHERE user_id = $2", [W.userOwnerB, W.userReader]))).toBe("AL009");
    // positive control: a change of role is the one change a membership accepts
    expect(await sqlstate(() => move("UPDATE membership SET role = 'ACCOUNTANT' WHERE user_id = $1", [W.userReader]))).toBeNull();
  });

  it("the instance keeps at least one active administrator (AL009, even for the table owner)", async () => {
    const run = (statements: [string, unknown[]][]): Promise<unknown> =>
      inContext(db, asOwnerA, async () => {
        for (const [sql, params] of statements) await db.query(sql, params);
      });
    expect(await sqlstate(() => run([["UPDATE app_user SET is_instance_admin = false WHERE id = $1", [W.userOwnerA]]]))).toBe("AL009");
    expect(await sqlstate(() => run([["UPDATE app_user SET disabled_at = now() WHERE id = $1", [W.userOwnerA]]]))).toBe("AL009");
    // positive control: with another administrator in place the first can be demoted or disabled
    const promoteB: [string, unknown[]] = ["UPDATE app_user SET is_instance_admin = true WHERE id = $1", [W.userOwnerB]];
    expect(await sqlstate(() => run([promoteB, ["UPDATE app_user SET is_instance_admin = false WHERE id = $1", [W.userOwnerA]]]))).toBeNull();
    expect(await sqlstate(() => run([promoteB, ["UPDATE app_user SET disabled_at = now() WHERE id = $1", [W.userOwnerA]]]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
// Identities and credentials
// ---------------------------------------------------------------------------------------------------------

describe("identity data", () => {
  it("T30 users of other companies and all other credentials are invisible", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await count(app, "app_user WHERE id = $1", [W.userOwnerB])).toBe(0);
      expect(await count(app, "user_credential")).toBe(1);
      expect(await rows(app, "SELECT user_id FROM user_credential")).toEqual([{ user_id: W.userOwnerA }]);
      expect(await count(app, "user_credential WHERE user_id = $1", [W.userReader])).toBe(0);
      // another user's credential cannot be changed either
      expect((await app.query("UPDATE user_credential SET password_hash = 'argon2-vole', updated_at = now() WHERE user_id = $1", [W.userReader])).rowCount).toBe(0);
      // positive control: the colleagues of the current company are visible, and the own credential can be changed
      expect((await rows<{ id: string }>(app, "SELECT id FROM app_user ORDER BY id")).map((r) => r.id)).toEqual([W.userOwnerA, W.userReader, W.userAccountant]);
      expect((await app.query("UPDATE user_credential SET password_changed_at = now(), updated_at = now() WHERE user_id = $1", [W.userOwnerA])).rowCount).toBe(1);
    });
    // without a company, only the user themself remains
    await inContext(app, { userId: W.userOwnerA }, async () => {
      expect((await rows<{ id: string }>(app, "SELECT id FROM app_user")).map((r) => r.id)).toEqual([W.userOwnerA]);
    });
  });

  it("keeps sessions, recovery codes and reset tokens to their own user", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await rows(app, "SELECT user_id FROM session")).toEqual([{ user_id: W.userOwnerA }]);
      expect(await rows(app, "SELECT user_id FROM user_recovery_code")).toEqual([{ user_id: W.userOwnerA }]);
      expect(await rows(app, "SELECT user_id FROM password_reset_token")).toEqual([{ user_id: W.userOwnerA }]);
      expect(await count(app, "session WHERE id = $1", [SESSION.reader])).toBe(0);
      // no session can be opened, and none closed, for someone else
      expect(await attempt(app, "INSERT INTO session (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", ["99".repeat(32), W.userReader])).toBe("42501");
      expect((await app.query("DELETE FROM session WHERE id = $1", [SESSION.reader])).rowCount).toBe(0);
      expect((await app.query("DELETE FROM user_recovery_code WHERE user_id = $1", [W.userReader])).rowCount).toBe(0);
      // positive control: the own session can be opened and closed
      expect((await app.query("INSERT INTO session (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", ["99".repeat(32), W.userOwnerA])).rowCount).toBe(1);
      expect((await app.query("DELETE FROM session WHERE id = $1", ["99".repeat(32)])).rowCount).toBe(1);
    });
    await inContext(app, {}, async () => {
      for (const table of ["session", "user_recovery_code", "password_reset_token"]) expect(await count(app, table), table).toBe(0);
    });
  });

  it("T32 the application cannot grant itself instance administration (column privilege)", async () => {
    await inContext(app, asReader, async () => {
      expect(await attempt(app, "UPDATE app_user SET is_instance_admin = true WHERE id = app_current_user_id()")).toBe("42501");
      // positive control: the columns the application is allowed to change are accepted
      expect((await app.query("UPDATE app_user SET display_name = 'Nouveau nom', updated_at = now() WHERE id = app_current_user_id()")).rowCount).toBe(1);
    });
    await inContext(app, asOwnerA, async () => {
      // an instance administrator is no exception
      expect(await attempt(app, "UPDATE app_user SET is_instance_admin = true WHERE id = app_current_user_id()")).toBe("42501");
    });
  });

  it("denies the other sensitive columns and the creation of users to the application as well", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, "UPDATE app_user SET disabled_at = now() WHERE id = app_current_user_id()")).toBe("42501");
      expect(await attempt(app, "UPDATE app_user SET email = 'autre@exemple.test' WHERE id = app_current_user_id()")).toBe("42501");
      expect(await attempt(app, "INSERT INTO app_user (id, email, display_name, updated_at) VALUES (gen_random_uuid(), 'nouveau@exemple.test', 'Nouveau', now())")).toBe("42501");
      expect(await attempt(app, "INSERT INTO user_credential (user_id, password_hash, password_changed_at, updated_at) VALUES (gen_random_uuid(), 'x', now(), now())")).toBe("42501");
      expect(await attempt(app, "UPDATE user_credential SET user_id = gen_random_uuid() WHERE user_id = app_current_user_id()")).toBe("42501");
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------------------------------------

describe("audit trail", () => {
  it("T31 the application cannot insert audit rows directly (privilege)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, "INSERT INTO audit_log (actor_kind, action, entity_type) VALUES ('SYSTEM', 'auth.forged', 'x')")).toBe("42501");
      expect(await count(app, "audit_log WHERE action = 'auth.forged'")).toBe(0);
      // positive control: the one door left open, app_audit_event, writes a row
      await app.query("SELECT app_audit_event('export.csv', 'report', 'trial-balance')");
      expect(await count(app, "audit_log WHERE action = 'export.csv'")).toBe(1);
    });
  });

  it("keeps the audit trail append-only: privileges for the application, a trigger for the table owner (AL004)", async () => {
    await inContext(app, asOwnerA, async () => {
      expect(await attempt(app, "UPDATE audit_log SET action = 'x.forged'")).toBe("42501");
      expect(await attempt(app, "DELETE FROM audit_log")).toBe("42501");
    });
    await inContext(db, asOwnerA, async () => {
      expect(await count(db, "audit_log")).toBeGreaterThan(0);
      expect(await attempt(db, "UPDATE audit_log SET action = 'x.forged'")).toBe("AL004");
      expect(await attempt(db, "DELETE FROM audit_log")).toBe("AL004");
      // positive control: adding a row is always possible for the owner (maintenance), as a system event
      expect(await attempt(db, "INSERT INTO audit_log (actor_kind, action, entity_type) VALUES ('SYSTEM', 'x.maintenance', 'x')")).toBeNull();
    });
  });

  it("writes application events through app_audit_event only, for a company the user belongs to (AL011)", async () => {
    await inContext(app, asOwnerA, async () => {
      await app.query("SELECT app_audit_event('export.csv', 'report', 'ledger', $1::jsonb)", [JSON.stringify({ rows: 12 })]);
      expect(await one(app, "SELECT actor_kind, actor_user_id, company_id, after FROM audit_log WHERE action = 'export.csv'")).toEqual({
        actor_kind: "USER",
        actor_user_id: W.userOwnerA,
        company_id: W.companyA,
        after: { rows: 12 },
      });
    });
    // no company, or a company the user does not belong to: refused, nothing is written
    for (const ctx of [{ userId: W.userOwnerA }, { userId: W.userOwnerA, companyId: W.companyB }]) {
      await inContext(app, ctx, async () => {
        expect(await attempt(app, "SELECT app_audit_event('export.csv', 'report', 'ledger')")).toBe("AL011");
      });
    }
    // an event outside any company (a sign-in) needs none, and belongs to nobody's company
    await inContext(app, { userId: W.userOwnerA }, async () => {
      expect(await attempt(app, "SELECT app_audit_event('auth.login', 'user', $1, NULL, true)", [W.userOwnerA])).toBeNull();
      expect(await one(app, "SELECT actor_user_id, company_id FROM audit_log WHERE action = 'auth.login'")).toEqual({ actor_user_id: W.userOwnerA, company_id: null });
    });
  });

  it("T50 audit rows carry the acting user and the request", async () => {
    await inContext(app, asOwnerA, async () => {
      await app.query("SELECT set_config('app.request_id', 'req-proprio', true)");
      const entryId = await postBalanced(app);
      expect(
        await one(
          app,
          `SELECT actor_kind, actor_user_id, company_id, request_id, after ? 'entry_number' AS has_number
             FROM audit_log WHERE entity_type = 'journal_entry' AND entity_id = $1 AND action = 'row.insert'`,
          [entryId],
        ),
      ).toEqual({ actor_kind: "USER", actor_user_id: W.userOwnerA, company_id: W.companyA, request_id: "req-proprio", has_number: true });
      expect(await count(app, "audit_log WHERE entity_type = 'journal_line' AND action = 'row.insert' AND request_id = 'req-proprio'")).toBe(2);

      // another user, another actor: the audit row follows the connection context, not the data
      await setContext(app, asAccountant);
      await app.query("SELECT set_config('app.request_id', 'req-comptable', true)");
      const contactId = randomUUID();
      await app.query("INSERT INTO contact (id, company_id, is_customer, display_name, updated_at) VALUES ($1, $2, true, 'Client du comptable', now())", [contactId, W.companyA]);
      await app.query("UPDATE contact SET phone = '514-555-0101', updated_at = now() WHERE id = $1", [contactId]);
      await app.query("DELETE FROM contact WHERE id = $1", [contactId]);
      const trail = await rows<{ action: string; actor_user_id: string; request_id: string; before: Row | null; after: Row | null }>(
        app,
        "SELECT action, actor_user_id, request_id, before, after FROM audit_log WHERE entity_type = 'contact' AND entity_id = $1 ORDER BY id",
        [contactId],
      );
      expect(trail.map((row) => [row.action, row.actor_user_id, row.request_id])).toEqual([
        ["row.insert", W.userAccountant, "req-comptable"],
        ["row.update", W.userAccountant, "req-comptable"],
        ["row.delete", W.userAccountant, "req-comptable"],
      ]);
      // an update keeps only what changed (updated_at is noise), an insert has no "before", a delete no "after"
      expect(trail[0]?.before).toBeNull();
      expect(trail[1]).toMatchObject({ before: { phone: null }, after: { phone: "514-555-0101" } });
      expect(Object.keys(trail[1]?.after ?? {})).toEqual(["phone"]);
      expect(trail[2]).toMatchObject({ before: { display_name: "Client du comptable" }, after: null });
    });
  });

  it("T50 no secret reaches the audit trail, and changes that are only noise are not logged", async () => {
    const SECRETS = ["password_hash", "totp_secret_enc"];
    // what the fixtures wrote when they created the credentials: rows exist, no secret in any of them
    expect(await count(db, "audit_log WHERE entity_type = 'user_credential'")).toBeGreaterThanOrEqual(4);
    expect(await count(db, "audit_log WHERE before ?| $1::text[] OR after ?| $1::text[]", [SECRETS])).toBe(0);
    expect(await count(db, "audit_log WHERE before::text LIKE '%argon2%' OR after::text LIKE '%argon2%'")).toBe(0);

    await inContext(app, { userId: W.userOwnerA }, async () => {
      await app.query("UPDATE user_credential SET password_hash = 'argon2-nouveau-secret', password_changed_at = now(), updated_at = now() WHERE user_id = $1", [W.userOwnerA]);
      const change = await one<{ before: Row; after: Row; company_id: string | null; actor_user_id: string }>(
        app,
        "SELECT before, after, company_id, actor_user_id FROM audit_log WHERE entity_type = 'user_credential' AND entity_id = $1 AND action = 'row.update'",
        [W.userOwnerA],
      );
      // the change is reported ("the password changed"), the value never is
      expect(change.after._secrets_changed).toEqual(["password_hash"]);
      expect(JSON.stringify([change.before, change.after])).not.toContain("argon2-nouveau-secret");
      expect(Object.keys(change.after)).not.toContain("password_hash");
      expect(change).toMatchObject({ company_id: null, actor_user_id: W.userOwnerA });

      // failed attempts, lock-out and last sign-in are noise: no audit row
      const before = await count(app, "audit_log WHERE entity_type IN ('user_credential', 'app_user')");
      await app.query("UPDATE user_credential SET failed_login_count = 3, locked_until = now() + interval '10 minutes' WHERE user_id = $1", [W.userOwnerA]);
      await app.query("UPDATE app_user SET last_login_at = now() WHERE id = $1", [W.userOwnerA]);
      expect(await count(app, "audit_log WHERE entity_type IN ('user_credential', 'app_user')")).toBe(before);
      // positive control: a real change of profile is logged
      await app.query("UPDATE app_user SET display_name = 'Nom modifié', updated_at = now() WHERE id = $1", [W.userOwnerA]);
      expect(await count(app, "audit_log WHERE entity_type = 'app_user'")).toBe(1);
    });
  });

  it("T51 a read-only member cannot read the audit trail", async () => {
    await inContext(app, asReader, async () => {
      expect(await count(app, "audit_log WHERE company_id IS NOT NULL")).toBe(0);
    });
    // positive control: the owner and the accountant do read it
    for (const ctx of [asOwnerA, asAccountant]) {
      await inContext(app, ctx, async () => {
        expect(await count(app, "audit_log WHERE company_id = $1", [W.companyA])).toBeGreaterThan(0);
      });
    }
  });

  it("keeps the audit trail of a company from the members of another company", async () => {
    await inContext(app, asOwnerB, async () => {
      expect(await count(app, "audit_log WHERE company_id = $1", [W.companyA])).toBe(0);
      expect(await count(app, "audit_log WHERE company_id = $1", [W.companyB])).toBeGreaterThan(0);
    });
  });

  it("shows events outside any company only to the user who acted or who is concerned", async () => {
    await inContext(app, {}, async () => {
      // what the login does for a failed attempt: no actor yet, the account concerned is the subject
      await app.query("SELECT app_audit_event('auth.login_failed', 'user', $1::text, '{\"reason\":\"password\"}'::jsonb, true, $2::uuid)", [W.userAccountant, W.userAccountant]);
      // the reader signs in
      await setContext(app, { userId: W.userReader });
      await app.query("SELECT app_audit_event('auth.login', 'user', $1, NULL, true)", [W.userReader]);

      const seenBy = async (ctx: { userId?: string }): Promise<string[]> => {
        await setContext(app, ctx);
        return (await rows<{ action: string }>(app, "SELECT action FROM audit_log WHERE company_id IS NULL AND action LIKE 'auth.%' ORDER BY action")).map((r) => r.action);
      };
      expect(await seenBy({ userId: W.userReader })).toEqual(["auth.login"]);
      expect(await seenBy({ userId: W.userAccountant })).toEqual(["auth.login_failed"]);
      expect(await seenBy({ userId: W.userOwnerA })).toEqual([]);
      expect(await seenBy({})).toEqual([]);
    });
  });
});

describe("Law 25 redaction of the audit trail", () => {
  const PII = ["email", "phone", "display_name"];

  it("T52 an owner redacts the personal data of a contact from the audit trail", async () => {
    await inContext(app, asOwnerA, async () => {
      await app.query("UPDATE contact SET email = 'marie@exemple.test', phone = '514-555-0101', updated_at = now() WHERE id = $1", [W.otherCustomer]);
      await app.query("UPDATE contact SET display_name = 'Contact anonymisé', email = NULL, phone = NULL, anonymized_at = now(), updated_at = now() WHERE id = $1", [W.otherCustomer]);
      const withPersonalData = "audit_log WHERE entity_type = 'contact' AND entity_id = $1 AND (before ?| $2::text[] OR after ?| $2::text[])";
      expect(await count(app, withPersonalData, [W.otherCustomer, PII])).toBeGreaterThanOrEqual(3);
      const keptBefore = await count(app, "audit_log WHERE entity_type = 'contact' AND entity_id = $1 AND after ? 'anonymized_at'", [W.otherCustomer]);
      expect(keptBefore).toBeGreaterThanOrEqual(2);

      const redacted = await one<{ n: number }>(app, "SELECT audit_redact('contact', $1, $2::text[]) AS n", [W.otherCustomer, PII]);
      expect(redacted.n).toBeGreaterThanOrEqual(3);
      expect(await count(app, withPersonalData, [W.otherCustomer, PII])).toBe(0);
      // only the personal keys went: the rest of the history is intact
      expect(await count(app, "audit_log WHERE entity_type = 'contact' AND entity_id = $1 AND after ? 'anonymized_at'", [W.otherCustomer])).toBe(keptBefore);
      // and the redaction is itself logged, with who did it and what it covered
      expect(await one(app, "SELECT actor_user_id, company_id, entity_type, entity_id, after FROM audit_log WHERE action = 'privacy.redact'")).toEqual({
        actor_user_id: W.userOwnerA,
        company_id: W.companyA,
        entity_type: "contact",
        entity_id: W.otherCustomer,
        after: { keys: PII, rows: redacted.n },
      });
    });
  });

  it("T53 an accountant, or a read-only member, cannot redact the audit trail", async () => {
    await inContext(app, asOwnerA, async () => {
      await app.query("UPDATE contact SET email = 'client@exemple.test', updated_at = now() WHERE id = $1", [W.customer]);
      const keys = ["email"];
      const withEmail = "audit_log WHERE entity_type = 'contact' AND entity_id = $1 AND after ? 'email'";
      const emailBefore = await count(app, withEmail, [W.customer]);
      expect(emailBefore).toBeGreaterThan(0);
      for (const ctx of [asAccountant, asReader]) {
        await setContext(app, ctx);
        expect(await attempt(app, "SELECT audit_redact('contact', $1, $2::text[])", [W.customer, keys])).toBe("42501");
      }
      // nothing was redacted by the refusals, and nothing was logged
      await setContext(app, asOwnerA);
      expect(await count(app, withEmail, [W.customer])).toBe(emailBefore);
      expect(await count(app, "audit_log WHERE action = 'privacy.redact'")).toBe(0);
      // positive control: the owner can
      expect((await one<{ n: number }>(app, "SELECT audit_redact('contact', $1, $2::text[]) AS n", [W.customer, keys])).n).toBeGreaterThan(0);
      expect(await count(app, withEmail, [W.customer])).toBe(0);
    });
  });

  it("T54 accounting fields cannot be redacted", async () => {
    const accountingKeys = ["id", "company_id", "debit_cents", "credit_cents", "amount_cents", "total_cents", "subtotal_cents", "tax_total_cents", "status", "account_id", "entry_date"];
    await inContext(app, asOwnerA, async () => {
      for (const key of accountingKeys) expect(await attempt(app, "SELECT audit_redact('journal_line', 'x', $1::text[])", [[key]]), key).toBe("42501");
      // one accounting key among personal ones refuses the whole request
      expect(await attempt(app, "SELECT audit_redact('journal_line', 'x', $1::text[])", [["email", "debit_cents"]])).toBe("42501");
      // positive control: a personal key is accepted (no such row here: nothing to redact)
      expect((await one<{ n: number }>(app, "SELECT audit_redact('journal_line', 'x', $1::text[]) AS n", [["email"]])).n).toBe(0);
    });
  });

  it("redacts only the trail of the current company", async () => {
    await inContext(app, asOwnerA, async () => {
      await app.query("UPDATE contact SET email = 'client@exemple.test', updated_at = now() WHERE id = $1", [W.customer]);
      const withEmail = "audit_log WHERE entity_type = 'contact' AND entity_id = $1 AND after ? 'email'";
      const emailBefore = await count(app, withEmail, [W.customer]);
      expect(emailBefore).toBeGreaterThan(0);
      // the owner of another company redacts the same entity: no row of theirs matches, the trail of A is untouched
      await setContext(app, asOwnerB);
      expect((await one<{ n: number }>(app, "SELECT audit_redact('contact', $1, ARRAY['email']) AS n", [W.customer])).n).toBe(0);
      await setContext(app, asOwnerA);
      expect(await count(app, withEmail, [W.customer])).toBe(emailBefore);
      // positive control: the owner of A redacts it
      expect((await one<{ n: number }>(app, "SELECT audit_redact('contact', $1, ARRAY['email']) AS n", [W.customer])).n).toBeGreaterThan(0);
      expect(await count(app, withEmail, [W.customer])).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Access before any context exists
// ---------------------------------------------------------------------------------------------------------

describe("lookups before the session", () => {
  it("T55 an invitation is readable by its token, without membership", async () => {
    expect(await rows(anon, "SELECT company_name, email, role FROM invitation_by_token($1)", [TOKEN.valid])).toEqual([
      { company_name: "Atelier Exemple inc.", email: "invite@exemple.test", role: "ACCOUNTANT" },
    ]);
    // the lookup is the only way in: the table itself stays closed to a connection without context
    expect(await count(anon, "invitation")).toBe(0);
    // positive control: a member sees the invitations of the company through the table
    await inContext(app, asOwnerA, async () => expect(await count(app, "invitation WHERE token_hash = $1", [TOKEN.valid])).toBe(1));
  });

  it("returns only a pending invitation, for the exact token", async () => {
    for (const token of [TOKEN.expired, TOKEN.revoked, TOKEN.accepted, TOKEN.unknown, "ab".repeat(16), ""]) {
      expect(await count(anon, "invitation_by_token($1)", [token]), token).toBe(0);
    }
  });

  it("T56 the login lookup returns only the requested account", async () => {
    expect(await rows(anon, "SELECT user_id, totp_enabled, disabled FROM auth_login_lookup($1)", ["  Proprio@Exemple.test "])).toEqual([
      { user_id: W.userOwnerA, totp_enabled: false, disabled: false },
    ]);
    // an unknown address, a pattern and an empty value find nobody
    for (const email of ["inconnu@exemple.test", "%@exemple.test", "proprio", ""]) expect(await count(anon, "auth_login_lookup($1)", [email]), email).toBe(0);
    // the state of the account travels with the answer: a disabled account says so
    expect(await rows(anon, "SELECT user_id, disabled FROM auth_login_lookup($1)", ["desactive@exemple.test"])).toEqual([{ user_id: F.userDisabled, disabled: true }]);
    // the tables behind the lookup stay closed
    expect(await count(anon, "user_credential")).toBe(0);
    expect(await count(anon, "app_user")).toBe(0);
  });

  it("looks up a session or a reset token by its exact identifier only", async () => {
    expect(await rows(anon, "SELECT user_id, totp_enabled, disabled FROM auth_session_lookup($1)", [SESSION.ownerA])).toEqual([{ user_id: W.userOwnerA, totp_enabled: false, disabled: false }]);
    expect(await count(anon, "auth_session_lookup($1)", ["00".repeat(32)])).toBe(0);
    expect(await rows(anon, "SELECT user_id, used FROM auth_password_reset_lookup($1)", [RESET.reader])).toEqual([{ user_id: W.userReader, used: false }]);
    expect(await count(anon, "auth_password_reset_lookup($1)", [RESET.unknown])).toBe(0);
    expect(await count(anon, "session")).toBe(0);
    expect(await count(anon, "password_reset_token")).toBe(0);
  });

  it("T57 setup is refused once the instance has been set up", async () => {
    const setup = (email: string, name: string): string =>
      `SELECT app_setup_instance(gen_random_uuid(), '${email}', 'Admin', 'argon2-placeholder', 'fr-CA', gen_random_uuid(), '${name}', 1)`;
    await inContext(app, {}, async () => {
      expect(await one(app, "SELECT auth_instance_is_set_up() AS done")).toEqual({ done: false });
      // positive control: the first pass is accepted and seals the instance
      expect(await attempt(app, setup("x@exemple.test", "X inc."))).toBeNull();
      expect(await one(app, "SELECT auth_instance_is_set_up() AS done")).toEqual({ done: true });
      expect(await count(app, "auth_login_lookup('x@exemple.test')")).toBe(1);
      // the second pass is refused, and creates nothing
      expect(await attempt(app, setup("y@exemple.test", "Y inc."))).toBe("42501");
      expect(await count(app, "auth_login_lookup('y@exemple.test')")).toBe(0);
    });
  });

  it("T58 a user who is not an instance administrator cannot create a company", async () => {
    const create = "SELECT app_create_company(gen_random_uuid(), 'Nouvelle inc.', 'fr-CA', 1)";
    for (const ctx of [asAccountant, asReader, asOwnerB]) {
      await inContext(app, ctx, async () => expect(await attempt(app, create), String(ctx.userId)).toBe("42501"));
    }
    await inContext(app, {}, async () => expect(await attempt(app, create)).toBe("42501"));
    // positive control: an instance administrator can, and becomes the owner of the new company
    await inContext(app, asOwnerA, async () => {
      const companyId = randomUUID();
      await app.query("SELECT app_create_company($1, 'Nouvelle inc.', 'fr-CA', 1)", [companyId]);
      expect(await rows(app, "SELECT user_id, role FROM membership WHERE company_id = $1", [companyId])).toEqual([{ user_id: W.userOwnerA, role: "OWNER" }]);
      await setContext(app, { userId: W.userOwnerA, companyId });
      expect(await one(app, "SELECT app_tenant_role() AS role")).toEqual({ role: "OWNER" });
    });
  });
});
