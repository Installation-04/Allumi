import { migrationCsvTemplate, migrationTemplateOptions } from "@/modules/migration";
import { loadCompany } from "../../_lib";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  await loadCompany(params, "migration.manage");
  const query = new URL(request.url).searchParams;
  const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
  const keys = ["kind", "locale", "delimiter"];
  if ([...query.keys()].some(key => !keys.includes(key)) || keys.some(key => query.getAll(key).length !== 1)) {
    return new Response(null, { status: 400, headers });
  }
  const parsed = migrationTemplateOptions.safeParse(Object.fromEntries(query));
  if (!parsed.success) return new Response(null, { status: 400, headers });
  const options = parsed.data, tab = options.delimiter === "\t";
  return new Response(migrationCsvTemplate(options), { headers: {
    ...headers,
    "Content-Type": `${tab ? "text/tab-separated-values" : "text/csv"}; charset=utf-8`,
    "Content-Disposition": `attachment; filename="quickbooks_${options.kind.toLowerCase()}_${options.locale}.${tab ? "tsv" : "csv"}"`,
  } });
}
