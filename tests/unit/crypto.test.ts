import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env() is memoized: reset the module registry so each test sees its own variables.
async function load() {
  vi.resetModules();
  return import("@/modules/auth/service/crypto");
}

beforeEach(() => {
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("APP_DATABASE_URL", "postgresql://allumi_app:x@localhost:5432/allumi");
  vi.stubEnv("AUTH_SECRET", "a".repeat(48));
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());

describe("crypto helpers", () => {
  it("hashes passwords with argon2id and verifies them", async () => {
    const { hashPassword, verifyPassword } = await load();
    const hash = await hashPassword("une phrase de passe très longue");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "une phrase de passe très longue")).toBe(true);
    expect(await verifyPassword(hash, "autre chose")).toBe(false);
    expect(await verifyPassword("not a hash", "x")).toBe(false);
  });

  it("property: decrypt(encrypt(x)) = x, and a tampered payload is refused", async () => {
    const { decrypt, encrypt } = await load();
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const payload = encrypt(text);
        expect(decrypt(payload)).toBe(text);
        const tampered = Uint8Array.from(payload);
        tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
        expect(() => decrypt(tampered)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it("uses a different nonce each time", async () => {
    const { encrypt } = await load();
    expect(Buffer.from(encrypt("x")).equals(Buffer.from(encrypt("x")))).toBe(false);
  });

  it("derives different rate-limit keys for different secrets", async () => {
    const first = (await load()).hmacHex("203.0.113.7");
    vi.stubEnv("AUTH_SECRET", "b".repeat(48));
    const second = (await load()).hmacHex("203.0.113.7");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("issues unguessable opaque tokens", async () => {
    const { newToken, sha256Hex } = await load();
    const [a, b] = [newToken(), newToken()];
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
