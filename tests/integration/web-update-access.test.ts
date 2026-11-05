import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { getUpdateOverview, requestUpdate } from "@/modules/updates";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";

const admin = randomUUID(), operator = randomUUID();
const target = "v0.4.1-alpha.1";
const fetchRelease = vi.fn(async () => new Response(JSON.stringify([
  { tag_name: target, draft: false, prerelease: true, published_at: "2026-11-01T12:00:00Z" },
]), { status: 200, headers: { "Content-Type": "application/json" } }));
let db: pg.Client, directory: string;

beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO app_user(id,email,display_name,is_instance_admin,can_manage_server,updated_at) VALUES ($1,'update-admin@example.test','Update admin',true,false,now()),($2,'update-operator@example.test','Update operator',false,true,now())", [admin, operator]);
  await db.query("UPDATE app_user SET is_instance_admin=false WHERE id=$1", [W.userOwnerA]);
  directory = await mkdtemp(join(tmpdir(), "allumi-update-access-"));
  vi.stubEnv("ALLUMI_UPDATE_DIR", directory);
  vi.stubGlobal("fetch", fetchRelease);
});
afterEach(async () => {
  fetchRelease.mockClear();
  for (const file of await readdir(directory)) await rm(join(directory, file), { force: true });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (directory) await rm(directory, { recursive: true, force: true });
  await db?.end();
});

it("does not grant host administration through a company role or disclose release/status data", async () => {
  for (const user of [W.userOwnerA, W.userAccountant, W.userReader, randomUUID()]) {
    await expect(getUpdateOverview(user)).rejects.toMatchObject({ key: "updates.forbidden" });
    await expect(requestUpdate(user, target)).rejects.toMatchObject({ key: "updates.forbidden" });
  }
  expect(fetchRelease).not.toHaveBeenCalled();
  expect(await readdir(directory)).toEqual([]);
});

it("allows instance administrators and delegated operators, then honors immediate revocation", async () => {
  for (const user of [admin, operator]) {
    const overview = await getUpdateOverview(user);
    expect(overview.release?.tag).toBe(target);
    expect(overview.status.state).toBe("ready");
  }
  await db.query("UPDATE app_user SET can_manage_server=false WHERE id=$1", [operator]);
  await expect(requestUpdate(operator, target)).rejects.toMatchObject({ key: "updates.forbidden" });
  await expect(getUpdateOverview(operator)).rejects.toMatchObject({ key: "updates.forbidden" });
  await db.query("UPDATE app_user SET can_manage_server=true,disabled_at=now() WHERE id=$1", [operator]);
  await expect(requestUpdate(operator, target)).rejects.toMatchObject({ key: "updates.forbidden" });
  await db.query("UPDATE app_user SET disabled_at=NULL WHERE id=$1", [operator]);
  expect(await readdir(directory)).toEqual([]);
});

it("queues exactly one fixed-shape request under simultaneous authorized submissions", async () => {
  const results = await Promise.allSettled([requestUpdate(admin, target), requestUpdate(operator, target)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const denied = results.find(result => result.status === "rejected");
  expect(denied && denied.status === "rejected" && denied.reason).toMatchObject({ key: "updates.pending" });
  const request = JSON.parse(await readFile(join(directory, "request.json"), "utf8"));
  expect(Object.keys(request).sort()).toEqual(["actor", "requestId", "requestedAt", "version"]);
  expect([admin, operator]).toContain(request.actor);
  expect(request.version).toBe(target);
  expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(Number.isFinite(Date.parse(request.requestedAt))).toBe(true);
  expect(await readdir(directory)).toEqual(["request.json"]);
});

it("rejects arbitrary commands and unavailable targets without touching the host queue", async () => {
  for (const value of ["main", "v0.4.1-alpha.1; id", "../../main", "v0.1.0", "v999.0.0"]) {
    await expect(requestUpdate(admin, value)).rejects.toMatchObject({ key: "updates.invalid" });
  }
  expect(await readdir(directory)).toEqual([]);
});
