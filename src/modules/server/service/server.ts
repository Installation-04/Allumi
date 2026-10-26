import "server-only";
import { readFile, writeFile, link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { recordEvent } from "@/modules/audit";
import { withUser } from "@/platform/tenant";
import { requireServerAccess } from "@/modules/auth";
import { AppError } from "@/platform/errors";
import { env } from "@/platform/env";
import { checkDatabase } from "@/platform/health";
import { appVersion } from "@/platform/version";
const snapshotSchema = z.object({ at: z.string().max(40), retentionDays: z.number().int().min(1).max(3650), backups: z.array(z.object({ name: z.string().regex(/^allumi-[0-9-]+\.tar(?:\.age)?$/), bytes: z.number().nonnegative(), at: z.string().max(40) })).max(100), events: z.array(z.object({ at: z.string().max(40), operation: z.enum(["backup", "retention"]), state: z.enum(["running", "success", "failed"]) })).max(100) });
const commandSchema = z.discriminatedUnion("operation", [z.object({ operation: z.literal("backup") }), z.object({ operation: z.literal("retention"), days: z.coerce.number().int().min(1).max(3650) })]);
export async function serverOverview(userId: string) {
  await requireServerAccess(userId);
  let databaseHealthy = true;
  try { await checkDatabase(); } catch { databaseHealthy = false; }
  const config = env();
  const dir = (process.env.ALLUMI_SERVER_ADMIN_ENABLED === "1" ? "/app/storage/server-control" : null);
  let snapshot: z.infer<typeof snapshotSchema> | null = null;
  let pending = false;
  if (dir) {
    try { const content = await readFile(join(dir, "snapshot.json"), "utf8"); if (content.length <= 100_000) snapshot = snapshotSchema.parse(JSON.parse(content)); } catch { /* No valid host snapshot yet. */ }
    try { await readFile(join(dir, "request.json"), "utf8"); pending = true; } catch { /* No pending request. */ }
  }
  return { version: appVersion(), url: new URL(config.APP_URL).origin, locale: config.DEFAULT_LOCALE, logLevel: config.LOG_LEVEL, trustedProxies: config.TRUSTED_PROXY_HOPS, databaseHealthy, enabled: Boolean(dir), snapshot, pending };
}
export async function requestServerOperation(userId: string, input: unknown) {
  await requireServerAccess(userId);
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new AppError("server.invalid");
  const dir = (process.env.ALLUMI_SERVER_ADMIN_ENABLED === "1" ? "/app/storage/server-control" : null);
  if (!dir) throw new AppError("server.disabled");
  const requestId = randomUUID();
  await withUser({ userId }, tx => recordEvent(tx, { action: "server.request", entityType: "server_operation", entityId: requestId, global: true, data: parsed.data }));
  const temporary = join(dir, `.request-${requestId}`);
  try {
    await writeFile(temporary, JSON.stringify({ ...parsed.data, actor: userId, requestedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    await link(temporary, join(dir, "request.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AppError("server.pending");
    throw error;
  } finally { await unlink(temporary).catch(() => {}); }
}
