import { CashForecastView } from "./view";
export { generateMetadata } from "./view";
export const dynamic="force-dynamic";
export default async function Page(props:{params:Promise<{companyId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 return CashForecastView(props);
}
