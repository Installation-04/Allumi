import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as FilePromises from "node:fs/promises";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const profile = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth", () => ({ getProfile: profile }));
vi.mock("@/platform/version", () => ({ appVersion: () => "0.1.0" }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof FilePromises>();
  return { ...actual, open: vi.fn(actual.open) };
});
import { open } from "node:fs/promises";
import { getUpdateOverview, getUpdateStatus, latestRelease, requestUpdate, updateStatus } from "@/modules/updates";
let directory: string;
const id = "e828ef5e-3c66-41ea-9cb9-b05708f664db";
const otherId = "0bb2c0f9-4d14-4895-a7ab-2998adb0a3ed";
const at = "2026-01-01T10:00:00.000Z";
const later = "2026-01-01T10:01:00.000Z";
const release = { tag_name: "v0.2.0", draft: false, prerelease: false, published_at: at };
const save = (name: string, value: unknown) => writeFile(join(directory, name), JSON.stringify(value));
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "allumi-status-"));
  vi.stubEnv("ALLUMI_UPDATE_DIR", directory);
  profile.mockReset().mockResolvedValue({ isInstanceAdmin: true });
  vi.mocked(open).mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [release] }));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(directory, { force: true, recursive: true }); });

it("reports disabled or ready locally and never fetches GitHub during a status poll", async () => {
  vi.stubEnv("ALLUMI_UPDATE_DIR", "");
  expect(await getUpdateStatus("admin")).toEqual({ state: "disabled" });
  expect(await updateStatus()).toBe("disabled");
  vi.stubEnv("ALLUMI_UPDATE_DIR", directory);
  expect(await getUpdateStatus("admin")).toEqual({ state: "ready" });
  expect(fetch).not.toHaveBeenCalled();
});

it("requires global server capability before any host file or release access", async () => {
  for (const identity of [null, { isInstanceAdmin: false, canManageServer: false }, { role: "OWNER" }]) {
    profile.mockResolvedValue(identity);
    await expect(getUpdateStatus("reader")).rejects.toMatchObject({ key: "updates.forbidden" });
    await expect(getUpdateOverview("reader")).rejects.toMatchObject({ key: "updates.forbidden" });
    await expect(requestUpdate("reader", "v0.2.0")).rejects.toMatchObject({ key: "updates.forbidden" });
  }
  expect(open).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  profile.mockResolvedValue({ canManageServer: true });
  expect((await getUpdateOverview("operator")).status.state).toBe("ready");
});

it("shows matching running stages ahead of the still-present queued request and strips host details", async () => {
  await save("request.json", { version: "v0.2.0", requestId: id, requestedAt: at, actor: "private-actor" });
  await save("status.json", { state: "running", stage: "backup", requestId: id, target: "v0.2.0", fromVersion: "0.1.0", requestedAt: at, at: later, error: "/host/secrets", command: "docker compose up", actor: "private-actor" });
  expect(await getUpdateStatus("admin")).toEqual({ state: "running", stage: "backup", requestId: id, target: "v0.2.0", fromVersion: "0.1.0", requestedAt: at, updatedAt: later });
  expect(await updateStatus()).toBe("running");
  await expect(requestUpdate("admin", "v0.2.0")).rejects.toMatchObject({ key: "updates.pending" });
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps a new request pending instead of reusing an old running or completed attempt", async () => {
  await save("request.json", { version: "v0.2.0", requestId: otherId, requestedAt: later });
  for (const state of ["running", "success", "failed"]) {
    await save("status.json", { state, stage: "complete", requestId: id, target: "v0.2.0", at });
    expect(await getUpdateStatus("admin")).toEqual({ state: "pending", requestId: otherId, requestedAt: later, target: "v0.2.0" });
  }
});

it("supports dated legacy status files and requests without IDs", async () => {
  await save("status.json", { state: "success", at });
  expect(await getUpdateStatus("admin")).toEqual({ state: "success", updatedAt: at });
  await save("request.json", { version: "v0.2.0", requestedAt: later });
  expect((await getUpdateStatus("admin")).state).toBe("pending");
  await save("status.json", { state: "running", at: "2026-01-01T10:02:00+00:00" });
  expect(await getUpdateStatus("admin")).toEqual({ state: "running", target: "v0.2.0", requestedAt: later, updatedAt: "2026-01-01T10:02:00.000Z" });
});

it("exposes only enum failure metadata and ignores malformed, oversized and symbolic files", async () => {
  await save("status.json", { state: "failed", stage: "installing", failureCode: "installation", target: "v0.2.0", requestId: id, updatedAt: later, detail: "/tmp/private.log" });
  expect(await getUpdateStatus("admin")).toEqual({ state: "failed", stage: "installing", failureCode: "installation", target: "v0.2.0", requestId: id, updatedAt: later });
  await save("status.json", { state: ["running"], stage: ["backup"] });
  expect(await getUpdateStatus("admin")).toEqual({ state: "ready" });
  await save("status.json", { state: "failed", stage: ["backup"], failureCode: ["installation"] });
  expect(await getUpdateStatus("admin")).toEqual({ state: "failed" });
  await save("status.json", { state: "failed", stage: "/host/path", failureCode: "run this command", target: "main; rm", fromVersion: "secret", requestedAt: "bad", at: "bad", requestId: "secret" });
  expect(await getUpdateStatus("admin")).toEqual({ state: "failed" });
  for (const text of ["{broken", "null", '"running"', JSON.stringify({ state: "running", padding: "x".repeat(5000) })]) {
    await writeFile(join(directory, "status.json"), text);
    expect(await getUpdateStatus("admin")).toEqual({ state: "ready" });
  }
  await rm(join(directory, "status.json"));
  await save("private.json", { state: "running", target: "v0.2.0" });
  await symlink(join(directory, "private.json"), join(directory, "status.json"));
  expect(await getUpdateStatus("admin")).toEqual({ state: "ready" });
  await writeFile(join(directory, "request.json"), "x".repeat(5000));
  expect(await getUpdateStatus("admin")).toEqual({ state: "pending" });
});

it("fails closed on an unreadable request without exposing permission errors", async () => {
  vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error("/host/secret permission denied"), { code: "EACCES" }));
  expect(await getUpdateStatus("admin")).toEqual({ state: "pending" });
});

it("retains local status when release discovery is unavailable and ignores unpublished tags", async () => {
  await save("status.json", { state: "success", at });
  vi.mocked(fetch).mockRejectedValueOnce(new Error("private proxy connection"));
  expect(await getUpdateOverview("admin")).toEqual({ currentVersion: "0.1.0", release: null, unavailable: true, status: { state: "success", updatedAt: at } });
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => [release, { ...release, tag_name: "v9.0.0", published_at: null }, { ...release, tag_name: "v8.0.0", published_at: "bad" }, { ...release, tag_name: "v7.0.0", draft: true }] } as Response);
  expect(await latestRelease()).toEqual({ tag: "v0.2.0", url: "https://github.com/Installation-04/Allumi/releases/tag/v0.2.0" });
});

it("revalidates authorization after discovery and before publishing a request", async () => {
  profile.mockResolvedValueOnce({ isInstanceAdmin: true }).mockResolvedValueOnce({ canManageServer: false });
  await expect(requestUpdate("admin", "v0.2.0")).rejects.toMatchObject({ key: "updates.forbidden" });
  expect(await readdir(directory)).toEqual([]);
  profile.mockReset().mockResolvedValueOnce({ isInstanceAdmin: true }).mockResolvedValueOnce({ isInstanceAdmin: true }).mockResolvedValueOnce({ isInstanceAdmin: false });
  await expect(requestUpdate("admin", "v0.2.0")).rejects.toMatchObject({ key: "updates.forbidden" });
  expect(await readdir(directory)).toEqual([]);
});

it("publishes one complete whitelisted request and never overwrites a competing submission", async () => {
  const results = await Promise.allSettled([requestUpdate("admin", "v0.2.0"), requestUpdate("operator", "v0.2.0")]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { key: "updates.pending" } });
  const request = JSON.parse(await readFile(join(directory, "request.json"), "utf8"));
  expect(Object.keys(request).sort()).toEqual(["actor", "requestId", "requestedAt", "version"]);
  expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(request.version).toBe("v0.2.0");
  expect(await readdir(directory)).toEqual(["request.json"]);
});
