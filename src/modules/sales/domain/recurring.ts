import { z } from "zod";
import { daysInMonth, formatIsoDate, isValidIsoDate, parseIsoDate } from "@/modules/ledger/client";
export const RECURRING_INTERVALS = [1, 3, 12] as const;
export function recurringDate(start: string, months: number, index: number, anchor: number): string | null {
  const date = parseIsoDate(start);
  if (!date || !(RECURRING_INTERVALS as readonly number[]).includes(months) || !Number.isInteger(index) || index < 0 || index > 13200 || !Number.isInteger(anchor) || anchor < 1 || anchor > 31) return null;
  const monthIndex = date.year * 12 + date.month - 1 + months * index;
  const year = Math.floor(monthIndex / 12), month = monthIndex % 12 + 1;
  return year > 2999 ? null : formatIsoDate(year, month, Math.min(anchor, daysInMonth(year, month)));
}
export function recurringDueDate(date: string, days: number) {
  if (!isValidIsoDate(date) || !Number.isInteger(days) || days < 0 || days > 365) return null;
  const value = new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate() + days);
  const result = value.toISOString().slice(0, 10);return isValidIsoDate(result) ? result : null;
}
export const recurringSchema = z.object({ creationKey: z.uuid(), sourceInvoiceId: z.uuid(), name: z.string().trim().min(1).max(100), startDate: z.string().refine(isValidIsoDate).refine(v=>v<="2998-12-31"), endDate: z.string().default("").refine(v=>!v||isValidIsoDate(v)&&v<="2998-12-31"), intervalMonths: z.coerce.number().refine(v=>(RECURRING_INTERVALS as readonly number[]).includes(v)), anchorDay: z.coerce.number().int().min(1).max(31), termDays: z.coerce.number().int().min(0).max(365) }).refine(v=>(!v.endDate||v.endDate>=v.startDate)&&recurringDate(v.startDate,v.intervalMonths,0,v.anchorDay)===v.startDate);
