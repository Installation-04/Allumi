import { AppError } from "@/platform/errors";

/** An omitted period uses the report default; explicit empty, repeated or malformed values never do. */
export function budgetPeriod(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new AppError("budgets.monthlyPeriod");
  return value;
}
