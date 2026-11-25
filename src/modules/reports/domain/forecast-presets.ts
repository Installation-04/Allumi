import { z } from "zod";
import { FORECAST_DELAYS, FORECAST_HORIZONS } from "./cash-forecast";

export const MAX_FORECAST_PRESETS = 20;
export const forecastPresetInput = z.object({
  name: z.string().refine(s => !/[\u0000-\u001f\u007f-\u009f]/u.test(s)).transform(s => s.trim()).refine(s => [...s].length >= 1 && [...s].length <= 80),
  days: z.number().refine(n => FORECAST_HORIZONS.some(d => d === n)),
  receiptDelay: z.number().refine(n => FORECAST_DELAYS.some(d => d === n)),
  paymentDelay: z.number().refine(n => FORECAST_DELAYS.some(d => d === n)),
});
export type ForecastPresetInput = z.infer<typeof forecastPresetInput>;
export type ForecastPreset = ForecastPresetInput & { id: string };

/** Applying a preset carries the displayed reference date, never a stored accounting snapshot. */
export function forecastPresetQuery(preset: Pick<ForecastPresetInput, "days" | "receiptDelay" | "paymentDelay">, asOf: string) {
  return new URLSearchParams({ date: asOf, jours: String(preset.days), delai_clients: String(preset.receiptDelay), delai_fournisseurs: String(preset.paymentDelay) }).toString();
}
