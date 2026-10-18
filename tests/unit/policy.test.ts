import { describe, expect, it } from "vitest";
import {
  isFullySignedIn,
  LOCK_AFTER_FAILURES,
  LOCK_MS,
  lockedUntil,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  sessionExpiry,
  sessionIsValid,
} from "@/modules/auth/domain/policy";

const T0 = new Date("2026-10-16T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("session policy", () => {
  const fresh = { createdAt: T0, lastSeenAt: T0, expiresAt: sessionExpiry(T0) };

  it("is valid right after creation", () => {
    expect(sessionIsValid(fresh, at(1000))).toBe(true);
  });

  it("expires after the idle delay", () => {
    expect(sessionIsValid(fresh, at(SESSION_IDLE_MS - 1))).toBe(true);
    expect(sessionIsValid(fresh, at(SESSION_IDLE_MS))).toBe(false);
  });

  it("expires after the absolute delay even when active", () => {
    const active = { ...fresh, lastSeenAt: at(SESSION_ABSOLUTE_MS - 1000) };
    expect(sessionIsValid(active, at(SESSION_ABSOLUTE_MS - 500))).toBe(true);
    expect(sessionIsValid(active, at(SESSION_ABSOLUTE_MS))).toBe(false);
  });
});

describe("lockout and second factor", () => {
  it("locks only once the threshold is reached", () => {
    expect(lockedUntil(LOCK_AFTER_FAILURES - 1, T0)).toBeNull();
    expect(lockedUntil(LOCK_AFTER_FAILURES, T0)?.getTime()).toBe(T0.getTime() + LOCK_MS);
  });

  it("requires the second factor only when it is enabled", () => {
    expect(isFullySignedIn({ totpEnabled: false, mfaVerifiedAt: null })).toBe(true);
    expect(isFullySignedIn({ totpEnabled: true, mfaVerifiedAt: null })).toBe(false);
    expect(isFullySignedIn({ totpEnabled: true, mfaVerifiedAt: T0 })).toBe(true);
  });
});
