import { getTranslations } from "@/platform/i18n/server";
import { BudgetPrintView } from "../print-view";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: (await getTranslations("budgetPrint"))("annualTitle") }; }
export default async function Page(props: { params: Promise<{companyId:string;budgetId:string}> }) {
  return BudgetPrintView(props);
}
