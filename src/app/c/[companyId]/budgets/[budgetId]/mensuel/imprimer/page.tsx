import { getTranslations } from "@/platform/i18n/server";
import { BudgetPrintView } from "../../print-view";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: (await getTranslations("budgetPrint"))("monthlyTitle") }; }
export default async function Page(props: { params: Promise<{companyId:string;budgetId:string}>; searchParams:Promise<{periode?:string|string[]}> }) {
  return BudgetPrintView({...props,monthly:true});
}
