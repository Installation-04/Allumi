import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCompanyFor, listCompaniesFor } from "@/modules/companies";
import { databaseRuleOf } from "@/platform/errors";
import { withAnonymous, withCompany, withUser } from "@/platform/tenant";
import { owner, seedCompany, seedUser, thrown } from "./helpers";

let db: pg.Client;
let alex: string; // owner of A
let camille: string; // accountant of A
let lou: string; // read-only member of A
let robin: string; // owner of B
let intrus: string; // member of nothing
let companyA: string;
let companyB: string;

beforeAll(async () => {
  db = await owner();
  alex = await seedUser(db, { email: "alex@exemple.test" });
  camille = await seedUser(db, { email: "camille@exemple.test" });
  lou = await seedUser(db, { email: "lou@exemple.test" });
  robin = await seedUser(db, { email: "robin@exemple.test" });
  intrus = await seedUser(db, { email: "intrus@exemple.test" });
  companyA = await seedCompany(db, "Entreprise A", [
    { userId: alex, role: "OWNER" },
    { userId: camille, role: "ACCOUNTANT" },
    { userId: lou, role: "READ_ONLY" },
  ]);
  companyB = await seedCompany(db, "Entreprise B", [{ userId: robin, role: "OWNER" }]);
  await db.query("INSERT INTO contact (id, company_id, is_customer, display_name, updated_at) VALUES ($1, $2, true, 'Client de B', now())", [randomUUID(), companyB]);
});
afterAll(async () => {
  await db.end();
});

const asAlex = { userId: "", companyId: "" };
beforeAll(() => {
  asAlex.userId = alex;
  asAlex.companyId = companyA;
});

describe("tenant isolation", () => {
  it("resolves a company and a role only for members", async () => {
    expect(await getCompanyFor(alex, companyA)).toMatchObject({ id: companyA, role: "OWNER" });
    expect(await getCompanyFor(camille, companyA)).toMatchObject({ role: "ACCOUNTANT" });
    expect(await getCompanyFor(lou, companyA)).toMatchObject({ role: "READ_ONLY" });
    expect(await getCompanyFor(alex, companyB)).toBeNull(); // IDOR: a company id taken from a URL
    expect(await getCompanyFor(intrus, companyA)).toBeNull();
    expect(await getCompanyFor(alex, randomUUID())).toBeNull();
  });

  it("lists only the companies of the user", async () => {
    expect((await listCompaniesFor(alex)).map((c) => c.name)).toEqual(["Entreprise A"]);
    expect(await listCompaniesFor(intrus)).toEqual([]);
  });

  it("hides another company's rows even when the caller names that company (IDOR)", async () => {
    const direct = await withCompany({ userId: robin, companyId: companyB }, (tx) => tx.contact.findMany());
    expect(direct).toHaveLength(1);
    const viaAlex = await withCompany({ userId: alex, companyId: companyB }, (tx) => tx.contact.findMany());
    expect(viaAlex).toEqual([]);
    const own = await withCompany(asAlex, (tx) => tx.contact.findMany());
    expect(own).toEqual([]);
  });

  it("refuses to write into a company the user does not belong to", async () => {
    const error = await thrown(() =>
      withCompany({ userId: alex, companyId: companyB }, (tx) => tx.contact.create({ data: { companyId: companyB, displayName: "Intrus", isCustomer: true } })),
    );
    expect(String(error)).toMatch(/row-level security|violates/i);
    expect((await db.query("SELECT count(*)::int AS n FROM contact WHERE company_id = $1", [companyB])).rows[0].n).toBe(1);
  });

  it("does not leak the context across pooled connections", async () => {
    const reads = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        withCompany(index % 2 === 0 ? asAlex : { userId: robin, companyId: companyB }, async (tx) => {
          const rows = await tx.$queryRaw<{ company: string }[]>`SELECT current_setting('app.company_id', true) AS company`;
          return { expected: index % 2 === 0 ? companyA : companyB, seen: rows[0]?.company };
        }),
      ),
    );
    for (const read of reads) expect(read.seen).toBe(read.expected);
    const outside = await withAnonymous((tx) => tx.$queryRaw<{ company: string | null }[]>`SELECT current_setting('app.company_id', true) AS company`);
    expect(outside[0]?.company ?? "").toBe("");
  });
});

describe("roles enforced by the database", () => {
  it("lets owners and accountants write, and records who did it", async () => {
    for (const userId of [alex, camille]) {
      await withCompany({ userId, companyId: companyA }, (tx) => tx.contact.create({ data: { companyId: companyA, displayName: `Client de ${userId.slice(0, 4)}`, isCustomer: true } }));
    }
    const audited = (await db.query("SELECT actor_user_id FROM audit_log WHERE entity_type = 'contact' AND company_id = $1 AND action = 'row.insert' ORDER BY id", [companyA])).rows.map((r) => r.actor_user_id);
    expect(audited).toEqual([alex, camille]);
  });

  it("lets a read-only member read but not write, and hides the audit trail from them", async () => {
    const readable = await withCompany({ userId: lou, companyId: companyA }, (tx) => tx.contact.findMany());
    expect(readable.length).toBeGreaterThanOrEqual(2);
    const error = await thrown(() => withCompany({ userId: lou, companyId: companyA }, (tx) => tx.contact.create({ data: { companyId: companyA, displayName: "Pas permis", isCustomer: true } })));
    expect(String(error)).toMatch(/row-level security|violates/i);
    expect(await withCompany({ userId: lou, companyId: companyA }, (tx) => tx.auditLog.findMany())).toEqual([]);
    expect((await withCompany(asAlex, (tx) => tx.auditLog.findMany())).length).toBeGreaterThan(0);
  });

  it("keeps member management to the owner", async () => {
    const error = await thrown(() =>
      withCompany({ userId: camille, companyId: companyA }, (tx) => tx.membership.create({ data: { companyId: companyA, userId: intrus, role: "OWNER" } })),
    );
    expect(String(error)).toMatch(/row-level security|violates/i);
    await withCompany(asAlex, (tx) => tx.membership.create({ data: { companyId: companyA, userId: intrus, role: "READ_ONLY" } }));
    expect(await getCompanyFor(intrus, companyA)).toMatchObject({ role: "READ_ONLY" });
    await withCompany(asAlex, (tx) => tx.membership.delete({ where: { companyId_userId: { companyId: companyA, userId: intrus } } }));
  });

  it("never lets a company lose its last owner", async () => {
    const error = await thrown(() =>
      withCompany({ userId: robin, companyId: companyB }, (tx) => tx.membership.update({ where: { companyId_userId: { companyId: companyB, userId: robin } }, data: { role: "READ_ONLY" } })),
    );
    expect(databaseRuleOf(error)).toBe("AL009");
    expect(await getCompanyFor(robin, companyB)).toMatchObject({ role: "OWNER" });
  });

  it("lets the owner, and only the owner, redact personal data from the audit trail", async () => {
    const contact = await withCompany(asAlex, (tx) => tx.contact.create({ data: { companyId: companyA, displayName: "Marie Tremblay", email: "marie@exemple.test", isCustomer: true } }));
    await withCompany(asAlex, (tx) => tx.contact.update({ where: { id: contact.id }, data: { displayName: "Contact anonymisé", email: null, anonymizedAt: new Date() } }));
    const before = JSON.stringify((await db.query("SELECT before, after FROM audit_log WHERE entity_id = $1", [contact.id])).rows);
    expect(before).toContain("marie@exemple.test");

    const refused = await thrown(() => withCompany({ userId: camille, companyId: companyA }, (tx) => tx.$queryRaw`SELECT audit_redact('contact', ${contact.id}, ARRAY['email', 'display_name'])`));
    expect(String(refused)).toMatch(/only an owner/);

    await withCompany(asAlex, (tx) => tx.$queryRaw`SELECT audit_redact('contact', ${contact.id}, ARRAY['email', 'display_name'])`);
    const after = JSON.stringify((await db.query("SELECT before, after FROM audit_log WHERE entity_id = $1", [contact.id])).rows);
    expect(after).not.toContain("marie@exemple.test");
    expect(after).not.toContain("Marie Tremblay");
    expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'privacy.redact'")).rows[0].n).toBe(1);
  });
});

describe("identity data", () => {
  it("shows each user only their own credentials", async () => {
    const credentials = await withUser({ userId: alex }, (tx) => tx.userCredential.findMany());
    expect(credentials.map((c) => c.userId)).toEqual([alex]);
    expect(await withAnonymous((tx) => tx.userCredential.findMany())).toEqual([]);
    expect(await withAnonymous((tx) => tx.user.findMany())).toEqual([]);
    expect(await withAnonymous((tx) => tx.company.findMany())).toEqual([]);
  });

  it("shows colleagues of the current company, not users of other companies", async () => {
    const visible = (await withCompany(asAlex, (tx) => tx.user.findMany())).map((u) => u.id).sort();
    expect(visible).toEqual([alex, camille, lou].sort());
  });

  it("does not let the application promote itself or write the audit trail", async () => {
    const promote = await thrown(() => withUser({ userId: alex }, (tx) => tx.$executeRaw`UPDATE app_user SET is_instance_admin = true WHERE id = ${alex}::uuid`));
    expect(String(promote)).toMatch(/permission denied/i);
    const forge = await thrown(() => withCompany(asAlex, (tx) => tx.$executeRaw`INSERT INTO audit_log (actor_kind, action, entity_type) VALUES ('SYSTEM', 'auth.forged', 'x')`));
    expect(String(forge)).toMatch(/permission denied/i);
  });

  it("reads an invitation by its token before any context exists", async () => {
    await db.query("INSERT INTO invitation (id, company_id, email, role, token_hash, expires_at, created_by_id) VALUES ($1, $2, 'invite@exemple.test', 'ACCOUNTANT', $3, now() + interval '7 days', $4)", [randomUUID(), companyA, "ab".repeat(32), alex]);
    const found = await withAnonymous((tx) => tx.$queryRaw<{ company_name: string; role: string }[]>`SELECT * FROM invitation_by_token(${"ab".repeat(32)})`);
    expect(found).toMatchObject([{ company_name: "Entreprise A", role: "ACCOUNTANT" }]);
    expect(await withAnonymous((tx) => tx.$queryRaw`SELECT * FROM invitation_by_token(${"cd".repeat(32)})`)).toEqual([]);
  });
});

describe("accounting rules reach the application as typed errors", () => {
  it("maps an AL003 raised by a trigger through Prisma and the driver", async () => {
    const error = await thrown(() =>
      withCompany(asAlex, (tx) => tx.$executeRaw`
        INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, created_by_id)
        VALUES (${randomUUID()}::uuid, ${companyA}::uuid, 1, '2026-01-15', ${randomUUID()}::uuid, 'MANUAL', ${alex}::uuid)`),
    );
    expect(databaseRuleOf(error)).toBe("AL003");
  });

  it("refuses to change the journal (privilege) with a non-Allumi error", async () => {
    const error = await thrown(() => withCompany(asAlex, (tx) => tx.$executeRaw`UPDATE journal_line SET debit_cents = 0`));
    expect(String(error)).toMatch(/permission denied/i);
    expect(databaseRuleOf(error)).toBeNull();
  });
});
