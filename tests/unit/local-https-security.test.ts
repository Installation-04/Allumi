import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientIpFromForwardedFor } from "@/modules/auth/domain/client-ip";

const mocks = vi.hoisted(() => ({ set: vi.fn(), cookies: new Map<string, string>(), forwarded: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.set, get: (name: string) => mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined }),
  headers: async () => mocks.forwarded,
}));
vi.mock("@/modules/auth", () => ({ clientIpFromForwardedFor, resolveSession: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  mocks.set.mockReset();
  mocks.cookies.clear();
  mocks.forwarded = new Headers({ "x-forwarded-proto": "http", "x-forwarded-for": "198.51.100.77" });
  vi.stubEnv("APP_DATABASE_URL", "postgresql://allumi_app:local@localhost:5432/allumi");
  vi.stubEnv("AUTH_SECRET", "a".repeat(48));
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("local HTTPS on an IP address", () => {
  it.each(["https://192.168.1.20:28080", "https://[fd00::20]:28080"])("sets, reads and expires a host-only Secure session at %s", async appUrl => {
    vi.stubEnv("APP_URL", appUrl);
    const session = await import("@/app/_lib/session");
    mocks.cookies.set("allumi_session", "stale-http-token");
    mocks.cookies.set("__Host-allumi_session", "secure-token");
    expect(await session.readSessionToken()).toBe("secure-token");
    const expires = new Date("2030-01-01T00:00:00Z");
    await session.setSessionCookie("new-token", expires);
    expect(mocks.set).toHaveBeenCalledWith("__Host-allumi_session", "new-token", { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires });
    await session.clearSessionCookie();
    expect(mocks.set).toHaveBeenLastCalledWith("__Host-allumi_session", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    // The origin's explicit port is not a cookie Domain, and neither forwarded scheme nor host can relax Secure.
    for (const [, , options] of mocks.set.mock.calls) expect(options).not.toHaveProperty("domain");
  });

  it("uses the configured proxy hop for address attribution without trusting a supplied scheme", async () => {
    vi.stubEnv("APP_URL", "https://192.168.1.20:28080");
    mocks.forwarded = new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.77", "x-forwarded-proto": "http", "x-forwarded-host": "attacker.example" });
    const session = await import("@/app/_lib/session");
    expect(await session.clientIp()).toBe("198.51.100.77");
    await session.setSessionCookie("token", new Date("2030-01-01T00:00:00Z"));
    expect(mocks.set).toHaveBeenCalledWith("__Host-allumi_session", "token", expect.objectContaining({ secure: true }));
  });
});
