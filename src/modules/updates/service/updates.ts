import "server-only";
import { constants } from "node:fs";
import { open, writeFile, mkdir, link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getProfile } from "@/modules/auth";
import { AppError } from "@/platform/errors";
import { appVersion } from "@/platform/version";
import { compareVersions, RELEASE_TAG, selectRelease } from "../domain/releases";
import type { UpdateStatusDetails } from "../domain/status";

const MAX_CONTROL_BYTES = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
};
const tag = (value: unknown): string | undefined => typeof value === "string" && RELEASE_TAG.test(value) ? value : undefined;
const version = (value: unknown): string | undefined => typeof value === "string" && RELEASE_TAG.test(value.startsWith("v") ? value : `v${value}`) ? value : undefined;
const requestId = (value: unknown): string | undefined => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

async function requireServerAccess(userId: string): Promise<void> {
  const profile = await getProfile(userId);
  if (!profile?.isInstanceAdmin && !profile?.canManageServer) throw new AppError("updates.forbidden");
}

/** Keep malformed or untrusted host contents out of the DTO, including raw paths and exception messages. */
async function readControl(path: string): Promise<{ present: boolean; value?: unknown }> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_CONTROL_BYTES) return { present: true };
    const buffer = Buffer.alloc(MAX_CONTROL_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > MAX_CONTROL_BYTES) return { present: true };
    return { present: true, value: JSON.parse(buffer.subarray(0, used).toString("utf8")) };
  } catch (error) {
    return { present: (error as NodeJS.ErrnoException).code !== "ENOENT" };
  } finally { await handle?.close().catch(() => {}); }
}

function statusMetadata(data: Record<string, unknown>): Omit<UpdateStatusDetails, "state"> {
  const result: Omit<UpdateStatusDetails, "state"> = {};
  const target = tag(data.target), fromVersion = version(data.fromVersion), requestedAt = timestamp(data.requestedAt), updatedAt = timestamp(data.updatedAt) ?? timestamp(data.at), id = requestId(data.requestId);
  if (target) result.target = target;
  if (fromVersion) result.fromVersion = fromVersion;
  if (requestedAt) result.requestedAt = requestedAt;
  if (updatedAt) result.updatedAt = updatedAt;
  if (id) result.requestId = id;
  if (typeof data.stage === "string" && ["validating", "backup", "installing", "complete"].includes(data.stage)) result.stage = data.stage as UpdateStatusDetails["stage"];
  if (data.state === "failed" && typeof data.failureCode === "string" && ["validation", "backup", "installation", "unknown"].includes(data.failureCode)) result.failureCode = data.failureCode as UpdateStatusDetails["failureCode"];
  return result;
}

async function readUpdateStatus(): Promise<UpdateStatusDetails> {
  const dir = updateDirectory();
  if (!dir) return { state: "disabled" };
  const [requestFile, statusFile] = await Promise.all([readControl(join(dir, "request.json")), readControl(join(dir, "status.json"))]);
  const request = object(requestFile.value), status = object(statusFile.value);
  const parsedStatus = status && typeof status.state === "string" && ["running", "success", "failed"].includes(status.state) ? { state: status.state as "running" | "success" | "failed", ...statusMetadata(status) } : null;
  if (!requestFile.present) return parsedStatus ?? { state: "ready" };
  const pending: UpdateStatusDetails = { state: "pending" };
  if (request) {
    const target = tag(request.version), at = timestamp(request.requestedAt), id = requestId(request.requestId);
    if (target) pending.target = target;
    if (at) pending.requestedAt = at;
    if (id) pending.requestId = id;
  }
  if (!parsedStatus) return pending;
  const sameId = pending.requestId && parsedStatus.requestId ? pending.requestId === parsedStatus.requestId : undefined;
  const sameLegacyAttempt = sameId === undefined && pending.requestedAt && parsedStatus.updatedAt && parsedStatus.updatedAt >= pending.requestedAt && (!parsedStatus.target || !pending.target || parsedStatus.target === pending.target);
  // A completed older attempt must never hide a new queued request. Legacy agents correlate by dated status.
  if (sameId || sameLegacyAttempt) return { ...pending, ...parsedStatus };
  return pending;
}

export async function latestRelease() {
  try {
    const response = await fetch("https://api.github.com/repos/Installation-04/Allumi/releases?per_page=50", { headers: { Accept: "application/vnd.github+json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new AppError("updates.unavailable");
    const releases: unknown = await response.json();
    // The UI only offers published releases; the host agent independently revalidates the selected tag.
    const published = Array.isArray(releases) ? releases.filter(value => { const entry = object(value); return entry && timestamp(entry.published_at) !== undefined; }) : releases;
    return selectRelease(published, appVersion().includes("-"));
  } catch { throw new AppError("updates.unavailable"); }
}
export function updateDirectory() { return process.env.ALLUMI_UPDATE_DIR || null; }
/** Legacy state-only API. New authenticated UI routes use getUpdateStatus. */
export async function updateStatus(): Promise<UpdateStatusDetails["state"]> { return (await readUpdateStatus()).state; }
export async function getUpdateStatus(userId: string): Promise<UpdateStatusDetails> {
  await requireServerAccess(userId);
  return readUpdateStatus();
}
export async function getUpdateOverview(userId: string) {
  await requireServerAccess(userId);
  const status = await readUpdateStatus();
  try { return { currentVersion: appVersion(), release: await latestRelease(), unavailable: false, status }; }
  catch { return { currentVersion: appVersion(), release: null, unavailable: true, status }; }
}
const assertIdle = (status: UpdateStatusDetails) => { if (status.state === "running" || status.state === "pending") throw new AppError("updates.pending"); };
export async function requestUpdate(userId: string, target: string) {
  await requireServerAccess(userId);
  const dir = updateDirectory();
  if (!dir) throw new AppError("updates.disabled");
  assertIdle(await readUpdateStatus());
  const release = await latestRelease();
  if (!release || release.tag !== target || compareVersions(target, appVersion()) <= 0) throw new AppError("updates.invalid");
  await requireServerAccess(userId);
  assertIdle(await readUpdateStatus());
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.request-${randomUUID()}`);
  try {
    await writeFile(temporary, JSON.stringify({ version: target, actor: userId, requestedAt: new Date().toISOString(), requestId: randomUUID() }), { flag: "wx", mode: 0o600 });
    await requireServerAccess(userId);
    assertIdle(await readUpdateStatus());
    await link(temporary, join(dir, "request.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AppError("updates.pending");
    throw error;
  } finally { await unlink(temporary).catch(() => {}); }
}
