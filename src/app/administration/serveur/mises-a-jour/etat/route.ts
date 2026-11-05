import { getSession, requireSession } from "@/app/_lib/session";
import { getProfile } from "@/modules/auth";
import { getUpdateStatus } from "@/modules/updates";
import { AppError } from "@/platform/errors";
import { appVersion } from "@/platform/version";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET() {
  const current = await getSession();
  if (!current || current.mfaPending) return Response.json({ error: "unauthorized" }, { status: 401, headers });
  const session = await requireSession();
  const profile = await getProfile(session.userId);
  if (!profile?.isInstanceAdmin && !profile?.canManageServer) return Response.json({ error: "forbidden" }, { status: 403, headers });
  try {
    return Response.json({ currentVersion: appVersion(), status: await getUpdateStatus(session.userId) }, { headers });
  } catch (error) {
    if (error instanceof AppError && error.key === "updates.forbidden") return Response.json({ error: "forbidden" }, { status: 403, headers });
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
