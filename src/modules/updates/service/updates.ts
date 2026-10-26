import "server-only";
import { readFile, writeFile, mkdir, link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getProfile } from "@/modules/auth";
import { AppError } from "@/platform/errors";
import { appVersion } from "@/platform/version";
import { compareVersions, selectRelease } from "../domain/releases";

export async function latestRelease() {
  const response = await fetch("https://api.github.com/repos/Installation-04/Allumi/releases?per_page=50", { headers: { Accept: "application/vnd.github+json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new AppError("updates.unavailable");
  return selectRelease(await response.json(), appVersion().includes("-"));
}
export function updateDirectory() { return process.env.ALLUMI_UPDATE_DIR || null; }
export async function updateStatus() {
  const dir = updateDirectory();
  if (!dir) return "disabled";
  try { await readFile(join(dir, "request.json"), "utf8"); return "pending"; } catch { /* No request waiting. */ }
  try {
    const status = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    return ["running", "success", "failed"].includes(status.state) ? String(status.state) : "ready";
  } catch { return "ready"; }
}
export async function requestUpdate(userId: string, target: string) {
  const profile = await getProfile(userId);
  if (!profile?.isInstanceAdmin && !profile?.canManageServer) throw new AppError("updates.forbidden");
  const dir = updateDirectory();
  if (!dir) throw new AppError("updates.disabled");
  const release = await latestRelease();
  if (!release || release.tag !== target || compareVersions(target, appVersion()) <= 0) throw new AppError("updates.invalid");
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.request-${randomUUID()}`);
  try {
    await writeFile(temporary, JSON.stringify({ version: target, actor: userId, requestedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    await link(temporary, join(dir, "request.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AppError("updates.pending");
    throw error;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
