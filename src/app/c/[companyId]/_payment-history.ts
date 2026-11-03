import { notFound } from "next/navigation";
import {
  parsePaymentHistoryFilters,
  type PaymentHistoryFilters,
} from "@/modules/payments";
import { AppError } from "@/platform/errors";

export function resolvePaymentHistoryFilters(
  query: Record<string, string | string[] | undefined>,
): PaymentHistoryFilters {
  try {
    return parsePaymentHistoryFilters({
      q: query.q,
      status: query.etat,
      from: query.du,
      to: query.au,
    });
  } catch (e) {
    if (e instanceof AppError && e.key === "payments.invalidFilters")
      notFound();
    throw e;
  }
}
export function paymentHistoryParams(
  filters: PaymentHistoryFilters,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      q: filters.q,
      etat: filters.status,
      du: filters.from,
      au: filters.to,
    }).filter(([, v]) => v),
  );
}
