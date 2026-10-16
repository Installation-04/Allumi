import { prisma } from "@/platform/db";
import { logger } from "@/platform/logger";
import { appVersion } from "@/platform/version";

export const dynamic = "force-dynamic";

/** Infrastructure contract: 200 + {"status":"ok","version"} when the database answers. No authentication, no other data. */
export async function GET(): Promise<Response> {
  try {
    await prisma().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", version: appVersion() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error({ err: error }, "health check failed");
    return Response.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
