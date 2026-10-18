import type { Locale } from "@/modules/ledger/client";

// Quantities have four decimals and unit prices six (the database columns are numeric(19,4) and numeric(19,6)).
// They are handled as scaled integers: 2.5 at scale 4 is 25000n. No float anywhere.

export const QUANTITY_SCALE = 4;
export const UNIT_PRICE_SCALE = 6;

const MAX_DIGITS = 19; // numeric(19, s): at most 19 significant digits

/**
 * Reads a decimal number typed by a person, at most `scale` decimals, as a scaled integer; null if it is not one.
 * fr-CA: spaces group digits and the decimal mark is a comma (a lone dot is accepted too); en: commas group digits
 * and the mark is a dot. A negative sign is allowed only when `allowNegative` (a discount line has a negative price).
 */
export function parseDecimal(input: string, scale: number, locale: Locale, allowNegative = false): bigint | null {
  let text = input.replace(/\s/g, "").replace("−", "-");
  let negative = false;
  if (text.startsWith("-")) {
    if (!allowNegative) return null;
    negative = true;
    text = text.slice(1);
  }
  if (text === "") return null;

  let wholeText: string;
  let fractionText = "";
  if (locale === "en") {
    const [whole, fraction, ...extra] = text.split(".");
    if (extra.length > 0 || whole === undefined) return null;
    wholeText = whole;
    fractionText = fraction ?? "";
    if (wholeText.includes(",")) {
      if (!/^\d{1,3}(,\d{3})+$/.test(wholeText)) return null;
      wholeText = wholeText.replaceAll(",", "");
    }
  } else {
    if (text.includes(",") && text.includes(".")) return null;
    const mark = text.includes(",") ? "," : ".";
    const [whole, fraction, ...extra] = text.split(mark);
    if (extra.length > 0 || whole === undefined) return null;
    wholeText = whole;
    fractionText = fraction ?? "";
  }
  if (!/^\d*$/.test(wholeText) || !new RegExp(`^\\d{0,${scale}}$`).test(fractionText)) return null;
  if (wholeText === "" && fractionText === "") return null;
  if ((wholeText.replace(/^0+/, "") + fractionText.padEnd(scale, "0")).length > MAX_DIGITS) return null;
  const value = BigInt(wholeText || "0") * 10n ** BigInt(scale) + BigInt(fractionText.padEnd(scale, "0") || "0");
  return negative ? -value : value;
}

/** Writes a scaled integer with at least `minDecimals` and at most `scale` decimals (trailing zeros beyond the minimum dropped). */
export function formatDecimal(value: bigint, scale: number, locale: Locale, minDecimals = 0): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const digits = magnitude.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  let fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  fraction = fraction.padEnd(minDecimals, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, locale === "en" ? "," : " ");
  const mark = locale === "en" ? "." : ",";
  return `${negative ? "-" : ""}${grouped}${fraction ? mark + fraction : ""}`;
}

/** A decimal string from the database (numeric) -> scaled integer. The database never stores more than `scale` decimals. */
export function decimalFromDb(text: string, scale: number): bigint {
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const value = BigInt(whole || "0") * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0").slice(0, scale) || "0");
  return negative ? -value : value;
}

/** Scaled integer -> the plain string that PostgreSQL's numeric accepts ("2.5"). */
export function decimalToDb(value: bigint, scale: number): string {
  return formatDecimal(value, scale, "en").replaceAll(",", "");
}
