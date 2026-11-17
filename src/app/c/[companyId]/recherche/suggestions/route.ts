import { getLocale } from "@/platform/i18n/server";
import { getSession } from "@/app/_lib/session";
import { getCompanyFor } from "@/modules/companies";
import { suggestCompany } from "@/modules/search";
import { AppError } from "@/platform/errors";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store", "Vary": "Cookie", "Cross-Origin-Resource-Policy": "same-origin", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const reply = (body: object, status = 200) => Response.json(body, { status, headers: HEADERS });
  try {
    const session = await getSession();
    if (!session || session.mfaPending) return reply({ error: "unauthorized" }, 401);
    const { companyId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId) || !await getCompanyFor(session.userId, companyId)) return reply({ error: "not_found" }, 404);
    const query = new URL(request.url).searchParams;
    if (query.getAll("q").length > 1 || [...query.keys()].some(key => key !== "q")) return reply({ error: "invalid" }, 400);
    const locale = (await getLocale()) === "en" ? "en" : "fr-CA";
    const rows = await suggestCompany({ userId: session.userId, companyId }, query.get("q") ?? "", locale);
    return reply({ rows });
  } catch (error) {
    if (error instanceof RangeError) return reply({ error: "invalid" }, 400);
    if (error instanceof AppError && error.key === "forbidden") return reply({ error: "not_found" }, 404);
    return reply({ error: "unavailable" }, 503);
  }
}
