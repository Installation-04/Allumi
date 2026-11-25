import { expect, it } from "vitest";
import { forecastPresetInput, forecastPresetQuery } from "@/modules/reports/client";

const input = { name: "Conservative", days: 30, receiptDelay: 14, paymentDelay: 7 };
it("validates saved assumptions without accepting coerced numbers, empty names or control characters", () => {
  expect(forecastPresetInput.parse({ ...input, name: "  Conservative  " }).name).toBe("Conservative");
  expect(forecastPresetInput.safeParse({ ...input, name: "🙂".repeat(80) }).success).toBe(true);
  for (const patch of [{name:""},{name:"x".repeat(81)},{name:"bad\nname"},{name:"bad\n"},{name:"a\u0000b"},{days:14},{days:"30"},{receiptDelay:1},{paymentDelay:-7},{receiptDelay:null},{paymentDelay:NaN}]) {
    expect(forecastPresetInput.safeParse({ ...input, ...patch }).success).toBe(false);
  }
});
it("applies only reusable filters at the requested reference date, without carrying amounts, identity or pagination", () => {
  const query = new URLSearchParams(forecastPresetQuery(input, "2026-06-30"));
  expect(Object.fromEntries(query)).toEqual({date:"2026-06-30",jours:"30",delai_clients:"14",delai_fournisseurs:"7"});
});
