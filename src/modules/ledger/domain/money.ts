// Money is a bigint count of cents. No float anywhere (docs/Regles-comptables.md).

export type Locale = "fr-CA" | "en";

/** Same ceiling as the CHECK on journal_line: 1,000 billion dollars per line. */
export const MAX_LINE_CENTS = 100_000_000_000_000n;

const NBSP = " ";

/**
 * THE rounding function: round(numerator / denominator) to an integer, half away from zero
 * (0.5 -> 1, -0.5 -> -1). It is the behaviour of PostgreSQL's round(numeric), which lets the database
 * check amounts that the application computed.
 */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("the denominator must be positive");
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = (2n * magnitude + denominator) / (2n * denominator);
  return negative ? -quotient : quotient;
}

function groupThousands(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+$)/g, separator);
}

/** `1 234,56 $` in fr-CA (non-breaking spaces), `$1,234.56` in en. */
export function formatMoney(cents: bigint, locale: Locale): string {
  const negative = cents < 0n;
  const magnitude = negative ? -cents : cents;
  const whole = (magnitude / 100n).toString();
  const fraction = (magnitude % 100n).toString().padStart(2, "0");
  const sign = negative ? "-" : "";
  return locale === "en"
    ? `${sign}$${groupThousands(whole, ",")}.${fraction}`
    : `${sign}${groupThousands(whole, NBSP)},${fraction}${NBSP}$`;
}

/**
 * Reads an amount typed by a person. Returns cents, or null when the text is not an amount: more than two
 * decimals (no sub-cent), several separators, letters, or above the ceiling. fr-CA: spaces group digits and
 * the decimal mark is a comma (a lone dot is accepted too); en: commas group digits and the mark is a dot.
 */
export function parseMoney(input: string, locale: Locale): bigint | null {
  let text = input.replace(/\s/g, "").replace(/\$/g, "").replace("−", "-");
  let negative = false;
  if (text.startsWith("-")) {
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

  if (!/^\d*$/.test(wholeText) || !/^\d{0,2}$/.test(fractionText)) return null;
  if (wholeText === "" && fractionText === "") return null;
  const cents = BigInt(wholeText || "0") * 100n + BigInt(fractionText.padEnd(2, "0"));
  if (cents > MAX_LINE_CENTS) return null;
  return negative ? -cents : cents;
}
