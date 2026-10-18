import { roundDiv } from "@/modules/ledger/client";
import { QUANTITY_SCALE, UNIT_PRICE_SCALE } from "./decimal";

/**
 * The amount of a document line, in cents: round(quantity × unit price × 100), half away from zero. It is the CHECK of
 * the database (sales_document_line_amount): quantity and price are scaled integers (4 and 6 decimals), so
 * quantity × price is scaled by 10^10 and a cent is 10^8 of that.
 */
export function lineAmountCents(quantityScaled: bigint, unitPriceScaled: bigint): bigint {
  return roundDiv(quantityScaled * unitPriceScaled, 10n ** BigInt(QUANTITY_SCALE + UNIT_PRICE_SCALE - 2));
}
