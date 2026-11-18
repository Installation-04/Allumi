import Link from "next/link";
import { getTranslations } from "@/platform/i18n/server";
import { can } from "@/modules/companies";
import { migrationHistory, MIGRATION_KINDS, type MigrationKind } from "@/modules/migration";
import { loadCompany } from "../_lib";
import { MigrationForm } from "./form";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: (await getTranslations("migration"))("title") }; }
export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ lot?: string | string[] }> }) {
  const { actor, company, locale } = await loadCompany(params, "migration.manage"), t = await getTranslations("migration"), q = await searchParams;
  const history = await migrationHistory(actor), batch = typeof q.lot === "string" ? history.find(h => h.id === q.lot) : null;
  const kinds: MigrationKind[] = MIGRATION_KINDS.filter(kind => can(company, kind === "CUSTOMERS" || kind === "SUPPLIERS" ? "contact.manage" : kind === "ITEMS" ? "catalog.manage" : "entry.post"));
  return <section className="space-y-6"><Link href={`/c/${company.id}/parametres`} className="inline-flex min-h-11 items-center text-sm underline">{t("back")}</Link><div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-2 max-w-4xl text-stone-600 dark:text-stone-400">{t("intro")}</p></div>
    <p className="max-w-4xl rounded-md border border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-900">{t("scope")}</p>
    <a href="https://github.com/Installation-04/Allumi/wiki/Migration-QuickBooks" className="inline-flex min-h-11 items-center underline">{t("guide")}</a>
    {batch ? <p role="status" className="rounded-md border border-brand-300 p-3">{t("complete", { created: batch.createdCount, skipped: batch.skippedCount })}{batch.journalEntryId ? <> <Link href={`/c/${company.id}/journal/${batch.journalEntryId}`} className="underline">{t("entry")}</Link></> : null}</p> : null}
    {kinds.length ? <MigrationForm key={batch?.id ?? "new"} companyId={company.id} kinds={kinds}/> : <p>{t("noModules")}</p>}
    <section aria-labelledby="migration-history" className="space-y-3"><h2 id="migration-history" className="text-lg font-semibold">{t("history")}</h2><p className="text-sm">{t("historyHint")}</p>{!history.length ? <p>{t("noHistory")}</p> : <ul className="space-y-3">{history.map(h => <li key={h.id} className="rounded-lg border border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-900"><p className="font-semibold">{h.source === "ONLINE" ? "QuickBooks Online" : "QuickBooks Desktop"} · {t(`kinds.${h.kind as MigrationKind}`)}</p><p>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(h.createdAt)}</p><p>{t("complete", { created: h.createdCount, skipped: h.skippedCount })}</p>{h.journalEntryId ? <Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/journal/${h.journalEntryId}`}>{t("entry")}</Link> : null}</li>)}</ul>}</section>
  </section>;
}
