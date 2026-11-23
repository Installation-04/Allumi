import "server-only";
import type { getTranslations } from "@/platform/i18n/server";
import type { ForecastCsvLabels } from "@/modules/reports";
export function forecastCsvLabels(t:Awaited<ReturnType<typeof getTranslations<"cashForecast">>>):ForecastCsvLabels{
 const keys=["title","scope","asOf","end","opening","incoming","outgoing","closing","minimum","negativeDays","excluded","beyond","future","receivableDifference","payableDifference","daily","date","detail","projectedDate","kind","number","party","documentDate","dueDate","carried","amount","invoice","bill","yes","no","accounts","code","account"] as const;
 return {...Object.fromEntries(keys.map(k=>[k,t(k)])),scope:[t("scope"),t("rules"),t("limits")].join(" ")} as ForecastCsvLabels;
}
