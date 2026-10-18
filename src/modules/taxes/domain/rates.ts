import { nextDay, previousDay, type IsoDate } from "@/modules/ledger/client";
import type { Locale } from "@/modules/ledger/client";
import { formatDecimal, parseDecimal } from "./decimal";

// A rate is a fraction with six decimals (the column is numeric(9,6)), held as an integer of millionths:
// 9.975 % is 0.09975, that is 99 750n. A person types a percentage with up to four decimals.

export const RATE_SCALE = 1_000_000n;
/** The database requires 0 <= rate < 1. */
export const MAX_RATE_MICRO = RATE_SCALE - 1n;

export type RateRow = { id: string; rateMicro: bigint; from: IsoDate; to: IsoDate | null };

/** "9,975" or "9.975" (a percentage) -> millionths (99 750n), or null if it is not a rate from 0 to under 100. */
export function parsePercent(input: string, locale: Locale): bigint | null {
  const percentScaled = parseDecimal(input.replace("%", ""), 4, locale);
  if (percentScaled === null) return null;
  // a percentage with four decimals is the fraction with six: 9.9750 % -> 99750 (the same digits)
  return percentScaled <= MAX_RATE_MICRO ? percentScaled : null;
}

/** 99 750n -> "9,975 %" (fr-CA) or "9.975%" (en). */
export function formatPercent(rateMicro: bigint, locale: Locale): string {
  const text = formatDecimal(rateMicro, 4, locale, 0);
  return locale === "en" ? `${text}%` : `${text} %`;
}

/** The rate in force on a date (both ends of a range are inclusive), or null if none covers it. */
export function rateOn(rows: readonly RateRow[], date: IsoDate): bigint | null {
  const row = rows.find((candidate) => date >= candidate.from && (candidate.to === null || date <= candidate.to));
  return row ? row.rateMicro : null;
}

export type RatePlan = { closePrevious?: { id: string; to: IsoDate } };
export type RatePlanProblem = "notAfterLast" | "overlap";

/**
 * Adds a rate to a history that is only ever extended at its end: the new rate starts after the last one has started
 * (earlier history is not rewritten), and the open-ended last rate is closed the day before. The database refuses
 * overlapping ranges too (EXCLUDE); this says why, before the request is sent.
 */
export function planRateChange(existing: readonly RateRow[], from: IsoDate): { ok: true; plan: RatePlan } | { ok: false; problem: RatePlanProblem } {
  if (existing.length === 0) return { ok: true, plan: {} };
  const last = [...existing].sort((a, b) => (a.from < b.from ? 1 : -1))[0];
  if (!last || from <= last.from) return { ok: false, problem: "notAfterLast" };
  if (last.to === null) return { ok: true, plan: { closePrevious: { id: last.id, to: previousDay(from) } } };
  if (last.to >= from) return { ok: false, problem: "overlap" };
  return { ok: true, plan: {} };
}

/** True when a tax has no gap in its history between two dates (used by the checks of the screens, not by the database). */
export function coversWithoutGap(rows: readonly RateRow[]): boolean {
  const sorted = [...rows].sort((a, b) => (a.from < b.from ? -1 : 1));
  return sorted.every((row, index) => {
    const next = sorted[index + 1];
    return next === undefined || (row.to !== null && nextDay(row.to) === next.from);
  });
}
