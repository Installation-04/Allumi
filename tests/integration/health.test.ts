import { describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json";

describe("GET /api/health", () => {
  it("answers 200 with the version when the database responds", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", version: packageJson.version });
  });

  it("prefers the version injected into the Docker image", async () => {
    vi.stubEnv("APP_VERSION", "9.9.9");
    const { GET } = await import("@/app/api/health/route");
    expect(await (await GET()).json()).toEqual({ status: "ok", version: "9.9.9" });
    vi.unstubAllEnvs();
  });

  it("answers 503 without leaking details when the database is down", async () => {
    vi.resetModules();
    const { closePrisma } = await import("@/platform/db");
    await closePrisma();
    const original = process.env.APP_DATABASE_URL;
    process.env.APP_DATABASE_URL = "postgresql://allumi_app:wrong@127.0.0.1:1/none";
    try {
      vi.resetModules();
      const { GET } = await import("@/app/api/health/route");
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "error" });
    } finally {
      process.env.APP_DATABASE_URL = original;
      const { closePrisma: close } = await import("@/platform/db");
      await close();
    }
  });
});
