import { searchContractCustomers } from "@/modules/contracts";
import { AppError } from "@/platform/errors";
import { loadCompany } from "../../_lib";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "Cross-Origin-Resource-Policy": "same-origin", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { actor } = await loadCompany(params, "sales.manage");
  const reply = (body: object, status = 200) => Response.json(body, { status, headers: HEADERS });
  const query = new URL(request.url).searchParams;
  if (query.getAll("q").length !== 1 || [...query.keys()].some(k => k !== "q")) return reply({ error: "invalid" }, 400);
  try { return reply(await searchContractCustomers(actor, query.get("q"))); }
  catch (error) {
    if (error instanceof RangeError) return reply({ error: "invalid" }, 400);
    if (error instanceof AppError && error.key === "forbidden") return reply({ error: "not_found" }, 404);
    throw error;
  }
}
