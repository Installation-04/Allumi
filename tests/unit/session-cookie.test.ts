import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set, get: () => undefined }),
  headers: async () => new Headers(),
}));

async function load() {
  vi.resetModules();
  return {
    names: await import("@/app/_lib/cookie-name"),
    session: await import("@/app/_lib/session"),
  };
}

beforeEach(() => {
  set.mockClear();
  vi.stubEnv("APP_DATABASE_URL", "postgresql://allumi_app:x@localhost:5432/allumi");
  vi.stubEnv("AUTH_SECRET", "a".repeat(48));
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());

describe("session cookie", () => {
  it("is pinned to the exact host (__Host- prefix) over HTTPS, and plain over HTTP", async () => {
    vi.stubEnv("APP_URL", "https://compta.exemple.ca");
    expect((await load()).names.sessionCookieName()).toBe("__Host-allumi_session");
    vi.stubEnv("APP_URL", "HTTPS://compta.exemple.ca");
    expect((await load()).names.sessionCookieName()).toBe("__Host-allumi_session");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect((await load()).names.sessionCookieName()).toBe("allumi_session");
  });

  it("is set httpOnly, SameSite=Lax, and Secure over HTTPS", async () => {
    vi.stubEnv("APP_URL", "https://compta.exemple.ca");
    const { session } = await load();
    await session.setSessionCookie("token", new Date("2030-01-01T00:00:00Z"));
    expect(set).toHaveBeenCalledWith("__Host-allumi_session", "token", expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax", path: "/" }));
  });

  it("is expired with the attributes it was set with: a __Host- cookie without Secure cannot be deleted", async () => {
    vi.stubEnv("APP_URL", "https://compta.exemple.ca");
    const { session } = await load();
    await session.clearSessionCookie();
    expect(set).toHaveBeenCalledWith("__Host-allumi_session", "", expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 }));
  });
});
