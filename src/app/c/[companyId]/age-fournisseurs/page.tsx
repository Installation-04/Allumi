import { can } from "@/modules/companies";
import { getTranslations } from "next-intl/server";
import { balanceDay } from "@/app/_lib/report-period";
import { todayIso } from "@/modules/ledger";
import { getPayablesAging } from "@/modules/reports";
import { loadCompany } from "../_lib";
import { AgingReport } from "../_aging-report";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("payablesAging"))("title")};}
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {company,actor,locale}=await loadCompany(params,"ledger.read");
  const asOf=balanceDay(await searchParams,todayIso());
  const aging=await getPayablesAging(actor,{asOf});
  return <AgingReport companyId={company.id} locale={locale} aging={aging} payable canViewContacts={can(company,"contact.read")} />;
}
