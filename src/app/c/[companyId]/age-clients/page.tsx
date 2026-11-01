import { notFound } from "next/navigation";
import { can } from "@/modules/companies";
import { getTranslations } from "next-intl/server";
import { balanceDay } from "@/app/_lib/report-period";
import { todayIso } from "@/modules/ledger";
import { getReceivablesAging } from "@/modules/reports";
import { loadCompany } from "../_lib";
import { AgingReport } from "../_aging-report";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("aging"))("title")};}
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {company,actor,locale}=await loadCompany(params,"ledger.read");
  if(!can(company,"sales.read"))notFound();
  const asOf=balanceDay(await searchParams,todayIso());
  const aging=await getReceivablesAging(actor,{asOf});
  return <AgingReport companyId={company.id} locale={locale} aging={aging} canViewContacts={can(company,"contact.read")} />;
}
