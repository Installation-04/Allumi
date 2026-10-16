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

  it("lists every invalid variable in one readable message", () => {
    expect(() => parseEnv({ ...GOOD, APP_URL: undefined, AUTH_SECRET: "short", ENCRYPTION_KEY: "AAAA" })).toThrowError(
      /APP_URL[\s\S]*AUTH_SECRET[\s\S]*ENCRYPTION_KEY|AUTH_SECRET[\s\S]*ENCRYPTION_KEY[\s\S]*APP_URL|ENCRYPTION_KEY/,
    );
    try {
      parseEnv({});
    } catch (error) {
      const message = (error as Error).message;
      for (const name of ["APP_URL", "APP_DATABASE_URL", "AUTH_SECRET", "ENCRYPTION_KEY"]) expect(message).toContain(name);
      expect(message).toContain(".env.example");
    }
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
