import { roundDiv } from "@/modules/ledger/client";
import { RATE_SCALE } from "./rates";

export type TaxRounding = "PER_LINE" | "PER_DOCUMENT";

/** A line to tax: its amount in cents and the taxes of its tax code (none for zero-rated, exempt, out of scope). */
export type TaxableLine = { amountCents: bigint; taxIds: readonly string[] };

export type TaxTotal = { taxId: string; rateMicro: bigint; baseCents: bigint; amountCents: bigint };

/**
 * The taxes of a document, as the database recomputes them (sales_document_taxes_are_exact): for each tax, the base is
 * the sum of the lines that carry it; the amount is the rate applied to each line and rounded (PER_LINE) or applied to
 * the base and rounded once (PER_DOCUMENT), half away from zero. One total per tax, in the order of the tax ids.
 * `rates` holds the rate in force on the document's date (or that of the credited invoice, for a credit note).
 */
export function computeTaxes(lines: readonly TaxableLine[], rates: ReadonlyMap<string, bigint>, rounding: TaxRounding): TaxTotal[] {
  const bases = new Map<string, bigint>();
  const amounts = new Map<string, bigint>();
  for (const line of lines) {
    for (const taxId of new Set(line.taxIds)) {
      const rate = rates.get(taxId);
      if (rate === undefined) throw new RangeError(`no rate for tax ${taxId}`);
      bases.set(taxId, (bases.get(taxId) ?? 0n) + line.amountCents);
      if (rounding === "PER_LINE") amounts.set(taxId, (amounts.get(taxId) ?? 0n) + roundDiv(line.amountCents * rate, RATE_SCALE));
    }
  }
  return [...bases.keys()]
    .sort()
    .map((taxId) => {
      const rateMicro = rates.get(taxId) ?? 0n;
      const baseCents = bases.get(taxId) ?? 0n;
      const amountCents = rounding === "PER_LINE" ? (amounts.get(taxId) ?? 0n) : roundDiv(baseCents * rateMicro, RATE_SCALE);
      return { taxId, rateMicro, baseCents, amountCents };
    });
}

export type DocumentTotals = { subtotalCents: bigint; taxTotalCents: bigint; totalCents: bigint };

export function documentTotals(lines: readonly TaxableLine[], taxes: readonly TaxTotal[]): DocumentTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0n);
  const taxTotalCents = taxes.reduce((sum, tax) => sum + tax.amountCents, 0n);
  return { subtotalCents, taxTotalCents, totalCents: subtotalCents + taxTotalCents };
}

/** The part of a purchase tax that can be claimed back (ITC / ITR), in basis points of the tax: 10 000 = all of it. */
export function recoverableCents(taxCents: bigint, basisPoints = 10_000n): bigint {
  if (basisPoints < 0n || basisPoints > 10_000n) throw new RangeError("a recoverable share is 0 to 10 000 basis points");
  return roundDiv(taxCents * basisPoints, 10_000n);
}
