import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadCompany, accountName } from "../_lib";
import { listAccounts } from "@/modules/ledger";
import { can } from "@/modules/companies";
import { getTaxConfiguration, getItem } from "@/modules/taxes";
import { ActionForm } from "@/app/_components/ui";
import { archiveAction } from "../taxes/actions";
import { ItemForm } from "./item-form";

export async function ItemEditor({ params, id }: { params: Promise<{ companyId: string }>; id?: string }) {
  const { company, actor, locale } = await loadCompany(params);
  const t = await getTranslations("catalog");
  const item = id ? await getItem(actor, id) : null;
  if (id && !item) notFound();
  const manage = can(company, "catalog.manage");
  if (!manage && !item) notFound();
  const accounts = await listAccounts(actor, { includeInactive: true });
  const { codes } = await getTaxConfiguration(actor);
  const options = (type: string) => accounts.filter((a) => a.type === type).map((a) => ({ value: a.id, label: `${a.code} — ${accountName(a, locale)}${a.isActive ? "" : ` (${t("archived")})`}` }));
  const initial = item ? Object.fromEntries(["name", "code", "description", "unitPrice", "incomeAccountId", "expenseAccountId", "defaultTaxCodeId"].map((key) => [key, String(item[key as keyof typeof item] ?? "")])) : {};
  return <section className="max-w-4xl space-y-5"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/catalogue`}>{t("back")}</Link><h1 className="text-2xl font-semibold">{item?.name ?? t("newItem")}</h1>
    {item && <p>{t(item.isActive ? "active" : "archived")}</p>}
    {manage ? <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"><ItemForm companyId={company.id} id={id} initial={initial} income={options("REVENUE")} expense={options("EXPENSE")} codes={codes.map((code) => ({ value: code.id, label: `${code.code} — ${locale === "en" ? code.nameEn : code.nameFr}${code.isActive ? "" : ` (${t("archived")})`}` }))} /></div> : <p>{item?.description} · {item?.unitPrice} CAD</p>}
    {manage && item && <ActionForm action={archiveAction.bind(null, company.id, "item", item.id, !item.isActive)} label={t(item.isActive ? "archive" : "restore")} />}
  </section>;
}
