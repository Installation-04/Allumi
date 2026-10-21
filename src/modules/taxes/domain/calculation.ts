import { isValidIsoDate, roundDiv } from "@/modules/ledger/client";

const SCALE = 1_000_000n;
/** Parse six-place decimal strings without passing monetary values through Number. */
export function decimalUnits(value: string): bigint {
  if (!/^-?\d{1,13}(?:\.\d{1,6})?$/.test(value)) throw new RangeError("Invalid decimal");
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
  return negative ? -units : units;
}
export function percentageRate(value: string): string {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,2}(?:\.\d{1,4})?$/.test(normalized)) throw new RangeError("Invalid percentage");
  const units = decimalUnits(normalized) / 100n;
  return `0.${units.toString().padStart(6, "0")}`;
}
export function ratePercentage(rate: string): string {
  const units = decimalUnits(rate);
  return `${units / 10000n}.${(units % 10000n).toString().padStart(4, "0")}`.replace(/\.?0+$/, "");
}
export type DatedRate = { rate: string; from: string; to: string | null };
export function effectiveRate(rates: DatedRate[], date: string): string {
  if (!isValidIsoDate(date)) throw new RangeError("Invalid date");
  const matches = rates.filter((r) => r.from <= date && (!r.to || r.to >= date));
  if (matches.length !== 1) throw new RangeError("Missing or ambiguous rate");
  return matches[0]!.rate;
}
export type TaxLine = { quantity: string; unitPrice: string; taxes: { id: string; rate: string }[] };
/** Independent taxes on the net base; half away from zero, matching PostgreSQL round(numeric). */
export function calculateTaxes(lines: TaxLine[], rounding: "PER_LINE" | "PER_DOCUMENT") {
  if (!["PER_LINE", "PER_DOCUMENT"].includes(rounding)) throw new RangeError("Invalid rounding");
  let subtotalCents = 0n;
  const totals = new Map<string, { id: string; rate: string; baseCents: bigint; amountCents: bigint }>();
  for (const line of lines) {
    const cents = roundDiv(decimalUnits(line.quantity) * decimalUnits(line.unitPrice) * 100n, SCALE * SCALE);
    subtotalCents += cents;
    const ids = new Set<string>();
    for (const tax of line.taxes) {
      const rate = decimalUnits(tax.rate);
      if (rate < 0n || rate >= SCALE || ids.has(tax.id)) throw new RangeError("Invalid tax");
      ids.add(tax.id);
      const total = totals.get(tax.id) ?? { ...tax, baseCents: 0n, amountCents: 0n };
      if (decimalUnits(total.rate) !== rate) throw new RangeError("Inconsistent tax rate");
      total.baseCents += cents;
      total.amountCents += roundDiv(cents * rate, SCALE);
      totals.set(tax.id, total);
    }
  }
  const taxes = [...totals.values()].map((tax) => ({ ...tax, amountCents: rounding === "PER_DOCUMENT" ? roundDiv(tax.baseCents * decimalUnits(tax.rate), SCALE) : tax.amountCents }));
  const taxCents = taxes.reduce((sum, tax) => sum + tax.amountCents, 0n);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents, taxes };
}
