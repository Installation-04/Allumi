import { describe, expect, it } from "vitest";
import { parseEnv } from "@/platform/env";

const GOOD = {
  APP_URL: "https://compta.exemple.ca",
  APP_DATABASE_URL: "postgresql://allumi_app:secret@db:5432/allumi",
  DATABASE_URL: "postgresql://allumi:owner@db:5432/allumi?schema=public",
  AUTH_SECRET: "x".repeat(48),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("environment validation", () => {
  it("accepts a complete configuration and applies defaults", () => {
    const env = parseEnv(GOOD);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DEFAULT_LOCALE).toBe("fr-CA");
    expect(env.SMTP_PORT).toBe(587);
  });

  it("accepts only an http(s) APP_URL, whatever the case of the scheme", () => {
    expect(parseEnv({ ...GOOD, APP_URL: "HTTPS://compta.exemple.ca" }).APP_URL).toBe("HTTPS://compta.exemple.ca");
    for (const bad of ["ftp://compta.exemple.ca", "javascript:alert(1)", "compta.exemple.ca"]) {
      expect(() => parseEnv({ ...GOOD, APP_URL: bad })).toThrowError(/APP_URL/);
    }
  });

  it("trusts one proxy by default, and checks the bounds", () => {
    expect(parseEnv(GOOD).TRUSTED_PROXY_HOPS).toBe(1);
    expect(parseEnv({ ...GOOD, TRUSTED_PROXY_HOPS: "2" }).TRUSTED_PROXY_HOPS).toBe(2);
    for (const bad of ["0", "6", "-1", "1.5", "deux"]) expect(() => parseEnv({ ...GOOD, TRUSTED_PROXY_HOPS: bad })).toThrowError(/TRUSTED_PROXY_HOPS/);
  });

  it("makes the setup token optional but never short", () => {
    expect(parseEnv(GOOD).SETUP_TOKEN).toBeUndefined();
    expect(parseEnv({ ...GOOD, SETUP_TOKEN: "" }).SETUP_TOKEN).toBeUndefined();
    expect(parseEnv({ ...GOOD, SETUP_TOKEN: "0123456789abcdef" }).SETUP_TOKEN).toBe("0123456789abcdef");
    expect(() => parseEnv({ ...GOOD, SETUP_TOKEN: "court" })).toThrowError(/SETUP_TOKEN/);
  });

  it("lists every invalid variable in one readable message", () => {
    const failure = (source: Record<string, string | undefined>): string => {
      try {
        parseEnv(source);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error("parseEnv should have thrown");
    };
    const some = failure({ ...GOOD, APP_URL: undefined, AUTH_SECRET: "short", ENCRYPTION_KEY: "AAAA" });
    for (const name of ["APP_URL", "AUTH_SECRET", "ENCRYPTION_KEY"]) expect(some).toContain(name);
    expect(some).not.toContain("APP_DATABASE_URL");

    const all = failure({});
    for (const name of ["APP_URL", "APP_DATABASE_URL", "AUTH_SECRET", "ENCRYPTION_KEY"]) expect(all).toContain(name);
    expect(all).toContain(".env.example");
  });

  it("treats empty values like missing ones", () => {
    expect(() => parseEnv({ ...GOOD, AUTH_SECRET: "" })).toThrowError(/AUTH_SECRET/);
    expect(parseEnv({ ...GOOD, SMTP_HOST: "" }).SMTP_HOST).toBeUndefined();
  });

  it("refuses to run the application with the owner credentials", () => {
    expect(() => parseEnv({ ...GOOD, APP_DATABASE_URL: GOOD.DATABASE_URL })).toThrowError(/allumi_app/);
  });

  it("does not require the owner URL (the app never gets it)", () => {
    expect(() => parseEnv({ ...GOOD, DATABASE_URL: undefined })).not.toThrow();
  });

  it("rejects an unknown locale and a non-base64 key of the wrong size", () => {
    expect(() => parseEnv({ ...GOOD, DEFAULT_LOCALE: "de" })).toThrowError(/DEFAULT_LOCALE/);
    expect(() => parseEnv({ ...GOOD, ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrowError(/ENCRYPTION_KEY/);
  });
});
