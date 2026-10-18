import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isSetUp, setupInstance } from "@/modules/auth";
import { owner, PASSWORD } from "./helpers";

let db: pg.Client;
beforeAll(async () => {
  db = await owner();
});
afterAll(async () => {
  await db.end();
});

const input = (overrides: Record<string, unknown> = {}) => ({
  companyName: "Atelier Exemple inc.",
  displayName: "Alex Exemple",
  email: "Alex@Exemple.test",
  password: PASSWORD,
  passwordConfirm: PASSWORD,
  locale: "fr-CA" as const,
  fiscalYearStartMonth: 4,
  ...overrides,
});

describe("first-run setup", () => {
  it("starts from an instance that is not set up", async () => {
    expect(await isSetUp()).toBe(false);
  });

  it("refuses a weak password and creates nothing", async () => {
    const result = await setupInstance(input({ password: "court", passwordConfirm: "court" }), "198.51.100.1");
    expect(result).toEqual({ status: "weak_password", problem: "tooShort" });
    expect(await isSetUp()).toBe(false);
    expect((await db.query("SELECT count(*)::int AS n FROM app_user")).rows[0].n).toBe(0);
  });

  it("asks for the setup token when the server has one, and creates nothing without it", async () => {
    const token = "0123456789abcdef0123456789abcdef";
    expect(await setupInstance(input(), "198.51.100.10", token)).toEqual({ status: "invalid_token" });
    expect(await setupInstance(input({ setupToken: "mauvais" }), "198.51.100.10", token)).toEqual({ status: "invalid_token" });
    expect(await isSetUp()).toBe(false);
    expect((await db.query("SELECT count(*)::int AS n FROM app_user")).rows[0].n).toBe(0);
  });

  it("creates the administrator and the company once, even when two requests race", async () => {
    const [a, b] = await Promise.all([
      setupInstance(input({ email: "premier@exemple.test" }), "198.51.100.2"),
      setupInstance(input({ email: "second@exemple.test" }), "198.51.100.3"),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["already_set_up", "ok"]);

    const [winner] = [a, b].filter((result) => result.status === "ok");
    if (winner?.status !== "ok") throw new Error("no winner");

    const users = (await db.query("SELECT id, email, is_instance_admin FROM app_user")).rows;
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: winner.userId, is_instance_admin: true });

    const memberships = (await db.query("SELECT role, company_id FROM membership WHERE user_id = $1", [winner.userId])).rows;
    expect(memberships).toEqual([{ role: "OWNER", company_id: winner.companyId }]);
    expect((await db.query("SELECT fiscal_year_start_month, currency FROM company")).rows).toEqual([{ fiscal_year_start_month: 4, currency: "CAD" }]);
    expect(await isSetUp()).toBe(true);
  });

  it("stores an argon2id hash and attributes the audit trail to the new administrator", async () => {
    const credential = (await db.query("SELECT password_hash FROM user_credential")).rows[0];
    expect(credential.password_hash).toMatch(/^\$argon2id\$/);
    expect(credential.password_hash).not.toContain(PASSWORD);

    const audited = (await db.query("SELECT entity_type, actor_kind, actor_user_id FROM audit_log WHERE entity_type IN ('company', 'membership', 'app_user')")).rows;
    expect(audited.length).toBeGreaterThanOrEqual(3);
    for (const row of audited) expect(row.actor_kind).toBe("USER");
    const trail = JSON.stringify((await db.query("SELECT before, after FROM audit_log")).rows);
    expect(trail).not.toContain("argon2");
  });

  it("is disabled afterwards", async () => {
    expect(await setupInstance(input({ email: "troisieme@exemple.test" }), "198.51.100.4")).toEqual({ status: "already_set_up" });
  });

  it("limits setup attempts per address", async () => {
    let last = "";
    for (let attempt = 0; attempt < 12; attempt++) last = (await setupInstance(input(), "198.51.100.99")).status;
    expect(last).toBe("rate_limited");
  });
});
