import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const profile = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth", () => ({ getProfile: profile }));
vi.mock("@/platform/version", () => ({ appVersion: () => "0.1.0" }));
import { requestUpdate } from "@/modules/updates";
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "allumi-request-"));
  vi.stubEnv("ALLUMI_UPDATE_DIR", directory);
  profile.mockResolvedValue({ isInstanceAdmin: true });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{ tag_name: "v0.2.0", draft: false, prerelease: false }] }));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
it("rejects a non-instance administrator before checking releases", async () => {
  profile.mockResolvedValue({ isInstanceAdmin: false });
  await expect(requestUpdate("reader", "v0.2.0")).rejects.toMatchObject({ key: "updates.forbidden" });
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects any target other than the newer published release", async () => {
  await expect(requestUpdate("admin", "v0.1.0")).rejects.toMatchObject({ key: "updates.invalid" });
  await expect(requestUpdate("admin", "main")).rejects.toMatchObject({ key: "updates.invalid" });
});
it("publishes one complete request and never replaces a pending request", async () => {
  const attempts = await Promise.allSettled([requestUpdate("admin-a", "v0.2.0"), requestUpdate("admin-b", "v0.2.0")]);
  expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(attempts.filter((result) => result.status === "rejected")).toMatchObject([{ reason: { key: "updates.pending" } }]);
  const request = JSON.parse(await readFile(join(directory, "request.json"), "utf8"));
  expect(request.version).toBe("v0.2.0");
  expect(["admin-a", "admin-b"]).toContain(request.actor);
  expect(Number.isFinite(Date.parse(request.requestedAt))).toBe(true);
});
