import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FOCUS } from "@/app/_components/focus";
import { searchText } from "@/app/_lib/search-params";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { listAuditLog } from "@/modules/audit";
import { can } from "@/modules/companies";
import { loadCompany } from "../_lib";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("audit"))("title") };
}

type Search = { objet?: string | string[]; action?: string | string[]; avant?: string | string[] };

export default async function AuditPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Search> }) {
  const { company, actor } = await loadCompany(params, "audit.read");
  if (!can(company, "audit.read")) notFound();
  const search = await searchParams;
  // a repeated or odd parameter is read as its first, clean value (an array would reach the query as is)
  const [objet, action, avant] = [searchText(search.objet), searchText(search.action), searchText(search.avant, 18)];
  const t = await getTranslations("audit");
  const result = await listAuditLog(actor, { entityType: objet, action, before: avant });
  const base = `/c/${company.id}/audit`;
  const next = new URLSearchParams();
  if (objet) next.set("objet", objet);
  if (action) next.set("action", action);
  if (result.nextCursor) next.set("avant", result.nextCursor);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-stone-700 dark:text-stone-300">{t("intro")}</p>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("filterObject")}</span>
          <input name="objet" defaultValue={objet} className={`rounded-md border border-stone-300 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("filterAction")}</span>
          <input name="action" defaultValue={action} className={`rounded-md border border-stone-300 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`} />
        </label>
        <button type="submit" className={`rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>
          {t("filter")}
        </button>
      </form>

      {result.entries.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <caption className="sr-only">{t("title")}</caption>
            <thead>
              <tr>
                <th scope="col" className={TH_CLASS}>{t("when")}</th>
                <th scope="col" className={TH_CLASS}>{t("who")}</th>
                <th scope="col" className={TH_CLASS}>{t("action")}</th>
                <th scope="col" className={TH_CLASS}>{t("object")}</th>
                <th scope="col" className={TH_CLASS}>{t("details")}</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className={`${TD_CLASS} whitespace-nowrap tabular-nums`}>{entry.occurredAt.toISOString().replace("T", " ").slice(0, 19)} UTC</td>
                  <td className={TD_CLASS}>
                    {entry.actorName ??
                      (entry.actorKind === "USER" ? (
                        <>
                          {t("formerMember")}
                          {entry.actorUserId ? <span className="block break-all text-xs text-stone-600 dark:text-stone-400">{entry.actorUserId}</span> : null}
                        </>
                      ) : (
                        t("system")
                      ))}
                  </td>
                  <td className={`${TD_CLASS} font-mono`}>{entry.action}</td>
                  <td className={TD_CLASS}>
                    <span className="font-mono">{entry.entityType}</span>
                    {entry.entityId ? <span className="block break-all text-xs text-stone-600 dark:text-stone-400">{entry.entityId}</span> : null}
                  </td>
                  <td className={TD_CLASS}>
                    <details>
                      <summary className={`cursor-pointer rounded-sm ${FOCUS}`}>{t("details")}</summary>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold">{t("before")}</p>
                          <pre className="overflow-x-auto rounded bg-stone-100 p-2 text-xs dark:bg-stone-800">{entry.before == null ? "—" : JSON.stringify(entry.before, null, 1)}</pre>
                        </div>
                        <div>
                          <p className="text-xs font-semibold">{t("after")}</p>
                          <pre className="overflow-x-auto rounded bg-stone-100 p-2 text-xs dark:bg-stone-800">{entry.after == null ? "—" : JSON.stringify(entry.after, null, 1)}</pre>
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.nextCursor ? (
        <Link href={`${base}?${next.toString()}`} className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>
          {t("older")}
        </Link>
      ) : null}
    </section>
  );
}
