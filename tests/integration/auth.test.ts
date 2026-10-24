import { randomBytes } from "node:crypto";
import type pg from "pg";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  attemptLogin,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  createSession,
  destroySession,
  disableTotp,
  completeMfaSignIn,
  resolveSession,
  totpStatus,
  verifySecondFactor,
} from "@/modules/auth";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "@/modules/auth/domain/policy";
import { sha256Hex } from "@/modules/auth/service/crypto";
import { purgeOldWindows } from "@/modules/auth/service/rate-limit";
import { owner, PASSWORD, seedUser } from "./helpers";

let db: pg.Client;
beforeAll(async () => {
  db = await owner();
});
afterAll(async () => {
  await db.end();
});
// Rate limits are tested on purpose below; everywhere else each test starts with empty windows.
beforeEach(async () => {
  await db.query("DELETE FROM rate_limit");
});

const login = (email: string, password = PASSWORD, ip = "203.0.113.10") => attemptLogin({ email, password, ip, userAgent: "vitest" });
const totpCode = (secret: string, timestamp: number) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp });

describe("sign-in", () => {
  it("signs a user in and opens a session whose token is never stored", async () => {
    const userId = await seedUser(db, { email: "alex@exemple.test" });
    const result = await login("  Alex@Exemple.TEST ");
    if (result.status !== "ok") throw new Error(`unexpected ${result.status}`);
    expect(result).toMatchObject({ userId, mfaRequired: false });

    expect(await resolveSession(result.token)).toMatchObject({ userId, mfaPending: false });
    const stored = (await db.query("SELECT id FROM session WHERE user_id = $1", [userId])).rows.map((row) => row.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]).not.toBe(result.token);
  });

  it("answers the same way for an unknown account and a wrong password", async () => {
    await seedUser(db, { email: "connu@exemple.test" });
    const wrong = await login("connu@exemple.test", "mauvais mot de passe");
    const unknown = await login("inconnu@exemple.test", "mauvais mot de passe");
    expect(wrong).toEqual({ status: "invalid" });
    expect(unknown).toEqual(wrong);
  });

  it("records failed sign-ins in the audit trail, visible to the targeted user", async () => {
    const userId = await seedUser(db, { email: "cible@exemple.test" });
    await login("cible@exemple.test", "mauvais mot de passe");
    const rows = (await db.query("SELECT actor_kind, subject_user_id, after FROM audit_log WHERE action = 'auth.login_failed' AND subject_user_id = $1", [userId])).rows;
    expect(rows).toEqual([{ actor_kind: "SYSTEM", subject_user_id: userId, after: { reason: "password" } }]);
    expect((await db.query("SELECT failed_login_count FROM user_credential WHERE user_id = $1", [userId])).rows[0].failed_login_count).toBe(1);
  });

  it("locks the account after ten failures and unlocks it when the delay is over", async () => {
    const userId = await seedUser(db, { email: "verrou@exemple.test" });
    for (let attempt = 0; attempt < 10; attempt++) {
      await db.query("DELETE FROM rate_limit");
      expect(await login("verrou@exemple.test", "mauvais mot de passe")).toEqual({ status: "invalid" });
    }
    await db.query("DELETE FROM rate_limit");
    expect(await login("verrou@exemple.test")).toEqual({ status: "invalid" }); // right password, still locked

    await db.query("UPDATE user_credential SET locked_until = now() - interval '1 minute' WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM rate_limit");
    expect((await login("verrou@exemple.test")).status).toBe("ok");
    expect((await db.query("SELECT failed_login_count, locked_until FROM user_credential WHERE user_id = $1", [userId])).rows[0]).toEqual({ failed_login_count: 0, locked_until: null });
  });

  it("starts a new series of failures once a lock has run out", async () => {
    const userId = await seedUser(db, { email: "serie@exemple.test" });
    await db.query("UPDATE user_credential SET failed_login_count = 10, locked_until = now() - interval '1 minute' WHERE user_id = $1", [userId]);
    expect(await login("serie@exemple.test", "mauvais mot de passe")).toEqual({ status: "invalid" });
    // one wrong password after the delay must not lock the account again
    expect((await db.query("SELECT failed_login_count, locked_until FROM user_credential WHERE user_id = $1", [userId])).rows[0]).toEqual({ failed_login_count: 1, locked_until: null });
    expect((await login("serie@exemple.test")).status).toBe("ok");
  });

  it("answers a locked account like an unknown one", async () => {
    const userId = await seedUser(db, { email: "bloque@exemple.test" });
    await db.query("UPDATE user_credential SET failed_login_count = 10, locked_until = now() + interval '10 minutes' WHERE user_id = $1", [userId]);
    const locked = await login("bloque@exemple.test", "mauvais mot de passe");
    const unknown = await login("fantome@exemple.test", "mauvais mot de passe");
    expect(locked).toEqual(unknown);
  });

  it("rate-limits attempts per e-mail address, even with the right password", async () => {
    await seedUser(db, { email: "limite@exemple.test" });
    for (let attempt = 0; attempt < 8; attempt++) await login("limite@exemple.test", "mauvais mot de passe", `198.51.100.${attempt}`);
    expect(await login("limite@exemple.test", PASSWORD, "198.51.100.50")).toEqual({ status: "rate_limited" });
  });

  it("rate-limits attempts per source address", async () => {
    let last = "";
    for (let attempt = 0; attempt < 32; attempt++) last = (await login(`personne${attempt}@exemple.test`, "x", "203.0.113.200")).status;
    expect(last).toBe("rate_limited");
  });

  it("forgets rate-limit windows that ended long ago", async () => {
    await db.query("INSERT INTO rate_limit (key, window_start, count) VALUES ('login:ip:old', now() - interval '2 days', 5), ('login:ip:recent', now(), 1)");
    await purgeOldWindows();
    expect((await db.query("SELECT key FROM rate_limit ORDER BY key")).rows.map((row) => row.key)).toEqual(["login:ip:recent"]);
  });

  it("keys the rate limits with a keyed hash: no address is stored in clear", async () => {
    await login("secret@exemple.test", "x", "203.0.113.77");
    const keys = (await db.query("SELECT key FROM rate_limit")).rows.map((row) => row.key as string);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const key of keys) {
      expect(key).not.toContain("203.0.113.77");
      expect(key).not.toContain("secret@exemple.test");
    }
  });
});

describe("sessions", () => {
  it("expires after the idle delay and after the absolute delay", async () => {
    const userId = await seedUser(db, { email: "session@exemple.test" });
    const t0 = new Date();
    // Activity slides the idle window, so each check uses its own session.
    const stillIdle = await createSession(userId, null, t0);
    expect(await resolveSession(stillIdle.token, new Date(t0.getTime() + SESSION_IDLE_MS - 1000))).not.toBeNull();
    const idle = await createSession(userId, null, t0);
    expect(await resolveSession(idle.token, new Date(t0.getTime() + SESSION_IDLE_MS + 1000))).toBeNull();
    expect((await db.query("SELECT count(*)::int AS n FROM session WHERE id = $1", [sha256Hex(idle.token)])).rows[0].n).toBe(0); // purged

    const absolute = await createSession(userId, null, t0);
    // kept active all along, still closed at the absolute limit
    await db.query("UPDATE session SET last_seen_at = $1 WHERE id = $2", [new Date(t0.getTime() + SESSION_ABSOLUTE_MS - 1000), sha256Hex(absolute.token)]);
    expect(await resolveSession(absolute.token, new Date(t0.getTime() + SESSION_ABSOLUTE_MS + 1000))).toBeNull();
  });

  it("rejects unknown, malformed and revoked tokens, and disabled accounts", async () => {
    const userId = await seedUser(db, { email: "revoque@exemple.test" });
    expect(await resolveSession(undefined)).toBeNull();
    expect(await resolveSession("court")).toBeNull();
    expect(await resolveSession(randomBytes(32).toString("base64url"))).toBeNull();

    const { token } = await createSession(userId, null);
    expect(await resolveSession(token)).not.toBeNull();
    await destroySession(userId, token);
    expect(await resolveSession(token)).toBeNull();

    const second = await createSession(userId, null);
    await db.query("UPDATE app_user SET disabled_at = now() WHERE id = $1", [userId]);
    expect(await resolveSession(second.token)).toBeNull();
    expect(await login("revoque@exemple.test")).toEqual({ status: "invalid" });
  });

  it("refreshes last_seen_at at most every few minutes", async () => {
    const userId = await seedUser(db, { email: "actif@exemple.test" });
    const t0 = new Date();
    const { token } = await createSession(userId, null, t0);
    await resolveSession(token, new Date(t0.getTime() + 60_000));
    const early = (await db.query("SELECT last_seen_at FROM session WHERE user_id = $1", [userId])).rows[0].last_seen_at as Date;
    expect(early.getTime()).toBe(t0.getTime());
    await resolveSession(token, new Date(t0.getTime() + 10 * 60_000));
    const later = (await db.query("SELECT last_seen_at FROM session WHERE user_id = $1", [userId])).rows[0].last_seen_at as Date;
    expect(later.getTime()).toBe(t0.getTime() + 10 * 60_000);
  });
});

describe("two-factor authentication", () => {
  async function enrolledUser(email: string) {
    const userId = await seedUser(db, { email });
    const enrollment = await beginTotpEnrollment(userId, email);
    if (!enrollment) throw new Error("no enrollment");
    const now = Date.now();
    const confirmed = await confirmTotpEnrollment(userId, totpCode(enrollment.secret, now), PASSWORD, { now: new Date(now) });
    if (confirmed.status !== "ok") throw new Error(`not confirmed: ${confirmed.status}`);
    return { userId, email, secret: enrollment.secret, recoveryCodes: confirmed.recoveryCodes, enrolledAt: now };
  }

  it("encrypts the secret at rest and shows ten recovery codes once", async () => {
    const { userId, secret, recoveryCodes } = await enrolledUser("deuxfacteurs@exemple.test");
    expect(recoveryCodes).toHaveLength(10);
    const row = (await db.query("SELECT totp_secret_enc, totp_enabled_at FROM user_credential WHERE user_id = $1", [userId])).rows[0];
    expect(Buffer.from(row.totp_secret_enc).toString("latin1")).not.toContain(secret);
    expect(row.totp_enabled_at).not.toBeNull();
    const hashes = (await db.query("SELECT code_hash FROM user_recovery_code WHERE user_id = $1", [userId])).rows.map((r) => r.code_hash as string);
    expect(hashes).toHaveLength(10);
    for (const code of recoveryCodes) expect(hashes).not.toContain(code);
    expect(await totpStatus(userId)).toEqual({ enabled: true, pending: false, recoveryCodesLeft: 10 });
  });

  it("does not enable anything with a wrong confirmation code", async () => {
    const userId = await seedUser(db, { email: "refus@exemple.test" });
    await beginTotpEnrollment(userId, "refus@exemple.test");
    expect(await confirmTotpEnrollment(userId, "000000", PASSWORD)).toEqual({ status: "invalid" });
    expect((await totpStatus(userId)).enabled).toBe(false);
    expect((await totpStatus(userId)).pending).toBe(true);
  });

  it("puts the session on hold until the second factor is done", async () => {
    const { userId, email, secret, enrolledAt } = await enrolledUser("attente@exemple.test");
    const result = await login(email);
    if (result.status !== "ok") throw new Error("login failed");
    expect(result.mfaRequired).toBe(true);
    expect(await resolveSession(result.token)).toMatchObject({ userId, mfaPending: true });

    // the code that enabled 2FA was used: it cannot be replayed
    expect(await verifySecondFactor(userId, totpCode(secret, enrolledAt), new Date(enrolledAt))).toBe("invalid");
    // the next time step works, once
    const later = enrolledAt + 30_000;
    expect(await verifySecondFactor(userId, totpCode(secret, later), new Date(later))).toBe("ok");
    expect(await verifySecondFactor(userId, totpCode(secret, later), new Date(later))).toBe("invalid");
  });

  it("accepts each recovery code once", async () => {
    const { userId, recoveryCodes } = await enrolledUser("recuperation@exemple.test");
    const [first, second] = recoveryCodes;
    expect(await verifySecondFactor(userId, (first ?? "").toLowerCase().replace("-", " "))).toBe("ok");
    expect(await verifySecondFactor(userId, first ?? "")).toBe("invalid");
    expect(await verifySecondFactor(userId, second ?? "")).toBe("ok");
    expect((await totpStatus(userId)).recoveryCodesLeft).toBe(8);
  });

  it("rate-limits code guessing", async () => {
    const { userId } = await enrolledUser("devinette@exemple.test");
    let last = "";
    for (let attempt = 0; attempt < 10; attempt++) last = await verifySecondFactor(userId, "000000");
    expect(last).toBe("rate_limited");
  });

  it("needs the password and a fresh code to turn two-factor authentication off", async () => {
    const { userId, secret, enrolledAt } = await enrolledUser("desactiver@exemple.test");
    const later = enrolledAt + 30_000;
    const code = totpCode(secret, later);
    expect(await disableTotp(userId, "mauvais mot de passe", code, { now: new Date(later) })).toBe("invalid");
    expect(await disableTotp(userId, PASSWORD, code, { now: new Date(later) })).toBe("ok");
    expect(await totpStatus(userId)).toEqual({ enabled: false, pending: false, recoveryCodesLeft: 0 });
    const row = (await db.query("SELECT totp_secret_enc FROM user_credential WHERE user_id = $1", [userId])).rows[0];
    expect(row.totp_secret_enc).toBeNull();
  });

  it("asks for the account password to turn two-factor authentication on, not only a valid code", async () => {
    const userId = await seedUser(db, { email: "motdepasse@exemple.test" });
    const enrollment = await beginTotpEnrollment(userId, "motdepasse@exemple.test");
    if (!enrollment) throw new Error("no enrollment");
    const now = Date.now();
    const code = totpCode(enrollment.secret, now);
    // someone who holds only a session cookie can read the pending secret back and compute a valid code: refused
    expect(await confirmTotpEnrollment(userId, code, "mauvais mot de passe", { now: new Date(now) })).toEqual({ status: "invalid" });
    expect(await confirmTotpEnrollment(userId, code, "", { now: new Date(now) })).toEqual({ status: "invalid" });
    expect((await totpStatus(userId)).enabled).toBe(false);
    // the right password and the same code: accepted (the refused tries did not use up the code)
    expect((await confirmTotpEnrollment(userId, code, PASSWORD, { now: new Date(now) })).status).toBe("ok");
    expect((await totpStatus(userId)).enabled).toBe(true);
  });

  it("reports a rate-limited confirmation as such, not as a wrong code", async () => {
    const userId = await seedUser(db, { email: "essais@exemple.test" });
    await beginTotpEnrollment(userId, "essais@exemple.test");
    let last: Awaited<ReturnType<typeof confirmTotpEnrollment>> = { status: "invalid" };
    for (let attempt = 0; attempt < 10; attempt++) last = await confirmTotpEnrollment(userId, "000000", PASSWORD);
    expect(last).toEqual({ status: "rate_limited" });
  });

  it("closes the user's other sessions when two-factor authentication is turned on, and verifies the current one", async () => {
    const userId = await seedUser(db, { email: "appareils@exemple.test" });
    const [current, other] = [await createSession(userId, "ordinateur"), await createSession(userId, "téléphone")];
    const enrollment = await beginTotpEnrollment(userId, "appareils@exemple.test");
    if (!enrollment) throw new Error("no enrollment");
    const now = Date.now();
    const confirmed = await confirmTotpEnrollment(userId, totpCode(enrollment.secret, now), PASSWORD, { keepSessionToken: current.token, now: new Date(now) });
    expect(confirmed.status).toBe("ok");
    expect(await resolveSession(other.token)).toBeNull();
    expect(await resolveSession(current.token)).toMatchObject({ userId, mfaPending: false });
  });

  it("closes the other sessions and forgets the second-factor proof when it is turned off", async () => {
    const { userId, secret, recoveryCodes, enrolledAt } = await enrolledUser("epoque@exemple.test");
    const [current, other] = [await createSession(userId, "ordinateur"), await createSession(userId, "téléphone")];
    expect(await completeMfaSignIn(userId, current.token, recoveryCodes[0]!)).toBe("ok");
    expect(await completeMfaSignIn(userId, other.token, recoveryCodes[1]!)).toBe("ok");
    const later = enrolledAt + 30_000;
    expect(await disableTotp(userId, PASSWORD, totpCode(secret, later), { keepSessionToken: current.token, now: new Date(later) })).toBe("ok");
    const remaining = (await db.query("SELECT id, mfa_verified_at FROM session WHERE user_id = $1", [userId])).rows;
    expect(remaining).toEqual([{ id: sha256Hex(current.token), mfa_verified_at: null }]);
  });
});

describe("concurrent MFA state changes", () => {
  it("confirms an enrollment only once and retains exactly the winning recovery codes", async () => {
    const userId = await seedUser(db, { email: "concurrent-enrollment@exemple.test" });
    const pending = (await beginTotpEnrollment(userId, "concurrent-enrollment@exemple.test"))!;
    const now = new Date();
    const code = totpCode(pending.secret, now.getTime());
    const results = await Promise.all([1, 2].map(() => confirmTotpEnrollment(userId, code, PASSWORD, { now })));
    expect(results.map(r => r.status).sort()).toEqual(["invalid", "ok"]);
    const winner = results.find(r => r.status === "ok")!;
    if (winner.status !== "ok") throw new Error("no winner");
    expect(await verifySecondFactor(userId, winner.recoveryCodes[0]!)).toBe("ok");
    expect((await totpStatus(userId)).recoveryCodesLeft).toBe(9);
  });

  it("cannot replace a pending secret while confirming the old one", async () => {
    const email = "replace-enrollment@exemple.test";
    const userId = await seedUser(db, { email });
    const pending = (await beginTotpEnrollment(userId, email))!;
    const now = new Date();
    const [confirmed, replacement] = await Promise.all([
      confirmTotpEnrollment(userId, totpCode(pending.secret, now.getTime()), PASSWORD, { now }),
      beginTotpEnrollment(userId, email),
    ]);
    if (confirmed.status === "ok") {
      expect(replacement).toBeNull();
      expect(await verifySecondFactor(userId, totpCode(pending.secret, now.getTime() + 30_000), new Date(now.getTime() + 30_000))).toBe("ok");
    } else {
      expect(confirmed.status).toBe("invalid");
      expect(replacement).not.toBeNull();
      expect((await totpStatus(userId)).enabled).toBe(false);
    }
  });

  it("cannot use the same TOTP both to sign in and to disable MFA", async () => {
    const email = "concurrent-disable@exemple.test";
    const userId = await seedUser(db, { email });
    const pending = (await beginTotpEnrollment(userId, email))!;
    const now = new Date();
    await confirmTotpEnrollment(userId, totpCode(pending.secret, now.getTime()), PASSWORD, { now });
    const session = await createSession(userId, null, now);
    const later = new Date(now.getTime() + 30_000);
    const code = totpCode(pending.secret, later.getTime());
    const results = await Promise.all([
      completeMfaSignIn(userId, session.token, code, later),
      disableTotp(userId, PASSWORD, code, { now: later }),
    ]);
    expect(results.sort()).toEqual(["invalid", "ok"]);
  });

  it("authorizes only one session for concurrent uses of one recovery code", async () => {
    const email = "concurrent-recovery@exemple.test";
    const userId = await seedUser(db, { email });
    const pending = (await beginTotpEnrollment(userId, email))!;
    const confirmed = await confirmTotpEnrollment(userId, totpCode(pending.secret, Date.now()), PASSWORD);
    if (confirmed.status !== "ok") throw new Error("no enrollment");
    const sessions = [await createSession(userId, null), await createSession(userId, null)];
    const results = await Promise.all(sessions.map(s => completeMfaSignIn(userId, s.token, confirmed.recoveryCodes[0]!)));
    expect(results.filter(r => r === "ok")).toHaveLength(1);
    for (let i = 0; i < sessions.length; i++) expect((await resolveSession(sessions[i]!.token))?.mfaPending).toBe(results[i] !== "ok");
    expect((await totpStatus(userId)).recoveryCodesLeft).toBe(9);
  });

  it("rolls back recovery-code consumption when session authorization fails", async () => {
    const email = "atomic-mfa@exemple.test";
    const userId = await seedUser(db, { email });
    const pending = (await beginTotpEnrollment(userId, email))!;
    const confirmed = await confirmTotpEnrollment(userId, totpCode(pending.secret, Date.now()), PASSWORD);
    if (confirmed.status !== "ok") throw new Error("no enrollment");
    const session = await createSession(userId, null);
    // Fault injection in this test file's isolated database, never in the application schema.
    await db.query(`CREATE FUNCTION test_mfa_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected session failure'; END $$;
      CREATE TRIGGER test_mfa_failure BEFORE UPDATE OF mfa_verified_at ON session FOR EACH ROW EXECUTE FUNCTION test_mfa_failure()`);
    try {
      await expect(completeMfaSignIn(userId, session.token, confirmed.recoveryCodes[0]!)).rejects.toThrow();
      expect((await totpStatus(userId)).recoveryCodesLeft).toBe(10);
      expect((await resolveSession(session.token))?.mfaPending).toBe(true);
      expect((await db.query("SELECT count(*)::int n FROM audit_log WHERE action='auth.recovery_code_used' AND entity_id=$1", [userId])).rows[0].n).toBe(0);
    } finally {
      await db.query("DROP TRIGGER test_mfa_failure ON session; DROP FUNCTION test_mfa_failure()");
    }
    expect(await completeMfaSignIn(userId, session.token, confirmed.recoveryCodes[0]!)).toBe("ok");
  });

  it("rejects expired, foreign, revoked and disabled sessions without consuming a recovery code", async () => {
    const email = "pending-expiry@exemple.test";
    const userId = await seedUser(db, { email });
    const now = new Date();
    const pending = (await beginTotpEnrollment(userId, email))!;
    const confirmed = await confirmTotpEnrollment(userId, totpCode(pending.secret, now.getTime()), PASSWORD, { now });
    if (confirmed.status !== "ok") throw new Error("no enrollment");
    const expired = await createSession(userId, null, new Date(now.getTime() - 600_000));
    const code = confirmed.recoveryCodes[0]!;
    expect(await resolveSession(expired.token, new Date(now.getTime() - 1))).toMatchObject({ mfaPending: true });
    expect(await completeMfaSignIn(userId, expired.token, code, now)).toBe("invalid");
    expect(await resolveSession(expired.token, now)).toBeNull();
    const foreignUser = await seedUser(db, { email: "foreign-session@exemple.test" });
    const foreign = await createSession(foreignUser, null, now);
    expect(await completeMfaSignIn(userId, foreign.token, code, now)).toBe("invalid");
    const revoked = await createSession(userId, null, now);
    await destroySession(userId, revoked.token);
    expect(await completeMfaSignIn(userId, revoked.token, code, now)).toBe("invalid");
    const disabled = await createSession(userId, null, now);
    await db.query("UPDATE app_user SET disabled_at=now() WHERE id=$1", [userId]);
    expect(await completeMfaSignIn(userId, disabled.token, code, now)).toBe("invalid");
    expect((await totpStatus(userId)).recoveryCodesLeft).toBe(10);
  });
});
