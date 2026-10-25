import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env() is memoized: reset the module registry so each test sees its own variables.
async function load() {
  vi.resetModules();
  return import("@/platform/secrets");
}

beforeEach(() => {
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("APP_DATABASE_URL", "postgresql://allumi_app:x@localhost:5432/allumi");
  vi.stubEnv("AUTH_SECRET", "a".repeat(48));
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());

const binding = { purpose: "integration-credentials", context: "company-1:connection-1" };

describe("secrets bound to their row", () => {
  it("property: decrypt(encrypt(x, b), b) = x, and a tampered payload is refused", async () => {
    const { decrypt, encrypt } = await load();
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const payload = encrypt(text, binding);
        expect(decrypt(payload, binding)).toBe(text);
        const tampered = Uint8Array.from(payload);
        tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
        expect(() => decrypt(tampered, binding)).toThrow();
      }),
    );
  });

  it("does not decrypt for another row, another company or another purpose", async () => {
    const { decrypt, encrypt } = await load();
    const payload = encrypt("sk_live_secret", binding);
    expect(decrypt(payload, binding)).toBe("sk_live_secret");
    expect(() => decrypt(payload, { ...binding, context: "company-1:connection-2" })).toThrow(); // copied to another connection
    expect(() => decrypt(payload, { ...binding, context: "company-2:connection-1" })).toThrow(); // copied to another company
    expect(() => decrypt(payload, { ...binding, purpose: "totp" })).toThrow(); // another use of the same key
  });

  it("keeps the two layouts apart: a bound payload is not a legacy one, and the reverse", async () => {
    const { decrypt, encrypt } = await load();
    expect(() => decrypt(encrypt("x", binding))).toThrow("Unsupported encryption version");
    expect(() => decrypt(encrypt("x"), binding)).toThrow("Unsupported encryption version");
    expect(decrypt(encrypt("x"))).toBe("x"); // the TOTP layout is unchanged
  });

  it("never repeats a payload for the same text (fresh IV), and hides the text", async () => {
    const { encrypt } = await load();
    const a = Buffer.from(encrypt("même texte", binding));
    const b = Buffer.from(encrypt("même texte", binding));
    expect(a.equals(b)).toBe(false);
    expect(a.toString("latin1")).not.toContain("même texte");
  });

  it("depends on ENCRYPTION_KEY: another key does not decrypt", async () => {
    const first = await load();
    const payload = first.encrypt("secret", binding);
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const second = await load();
    expect(() => second.decrypt(payload, binding)).toThrow();
  });
});
