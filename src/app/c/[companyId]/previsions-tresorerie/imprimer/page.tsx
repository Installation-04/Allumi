import { getTranslations } from "@/platform/i18n/server";
import { CashForecastView } from "../view";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("cashForecast"))("printView")};}
/** A separate authorized view always loads the complete bounded report, never just the visible page. */
export default async function Page(props:{params:Promise<{companyId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 return CashForecastView({...props,print:true});
}
