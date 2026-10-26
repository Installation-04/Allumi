import { isValidIsoDate } from "@/modules/ledger/client";

export type DecimalSeparator = "." | ",";
export type DateOrder = "YMD" | "DMY" | "MDY";

/** Statement amounts stay far below this (ten thousand billion dollars); a bigger figure is a misread column. */
const MAX_CENTS = 1_000_000_000_000_000n;

const GROUP_SEPARATORS = /[\s  '’]/g;
const CURRENCY_MARKS = /(?:CA\$|US\$|CAD|USD|\$|€|£)/gi;

/**
 * An amount as a statement writes it, in exact cents: `1 234,56`, `-$12.30`, `(45.00)`, `12.30-`, `+7,5`.
 * The decimal separator is the one the person chose (`.` or `,`); the other one may only group thousands. Anything
 * that is not exactly an amount (a third decimal, a letter, two signs) is null: the caller says which row is wrong
 * instead of guessing.
 */
export function parseAmount(raw: string, decimal: DecimalSeparator): bigint | null {
  let text = raw.replace(GROUP_SEPARATORS, "").replace(CURRENCY_MARKS, "");
  if (text === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  const leading = /^[-−+]/.exec(text)?.[0];
  if (leading) {
    if (negative) return null;
    negative = leading !== "+";
    text = text.slice(1);
  }
  if (/[-−]$/.test(text)) {
    if (negative) return null;
    negative = true;
    text = text.slice(0, -1);
  }
  const group = decimal === "." ? "," : ".";
  const escaped = (value: string) => value.replace(/[.,]/g, "\\$&");
  const grouped = new RegExp(`^\\d{1,3}(?:${escaped(group)}\\d{3})+(?:${escaped(decimal)}\\d{1,2}0*)?$`);
  const plain = new RegExp(`^\\d+(?:${escaped(decimal)}\\d{1,2}0*)?$`);
  if (!grouped.test(text) && !plain.test(text)) return null;
  const [whole = "", fraction = ""] = text.split(group).join("").split(decimal);
  const cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
  if (cents >= MAX_CENTS) return null;
  return negative ? -cents : cents;
}

/** `1 234,56`-style text that has a comma and no point is read with a comma as the decimal separator. */
export function guessDecimalSeparator(samples: string[]): DecimalSeparator {
  let comma = 0;
  let point = 0;
  for (const sample of samples) {
    if (/,\d{1,2}\s*$/.test(sample) && !/\.\d{1,2}\s*$/.test(sample)) comma++;
    else if (/\.\d{1,2}\s*$/.test(sample)) point++;
  }
  return comma > point ? "," : ".";
}

/**
 * A date as a statement writes it: `2026-10-15`, `2026/10/15`, `15/10/2026`, `10/15/2026`, `15.10.26`, `20261015`,
 * with or without a time after it. The order is the person's choice (`YMD`, `DMY`, `MDY`); a two-digit year is
 * 20yy. Only a real calendar day comes back (YYYY-MM-DD).
 */
export function parseStatementDate(raw: string, order: DateOrder): string | null {
  const text = raw.trim().split(/[\sT]/)[0] ?? "";
  let year: string;
  let month: string;
  let day: string;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  const compactOther = /^(\d{2})(\d{2})(\d{4})$/.exec(text);
  const separated = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/.exec(text);
  if (compact && order === "YMD") [, year = "", month = "", day = ""] = compact;
  else if (compactOther && order !== "YMD") [, day = "", month = "", year = ""] = order === "DMY" ? compactOther : [compactOther[0], compactOther[2], compactOther[1], compactOther[3]];
  else if (separated) {
    const [, a = "", b = "", c = ""] = separated;
    if (order === "YMD") [year, month, day] = [a, b, c];
    else if (order === "DMY") [day, month, year] = [a, b, c];
    else [month, day, year] = [a, b, c];
  } else return null;
  if (year.length === 2) year = `20${year}`;
  if (year.length !== 4 || month.length > 2 || day.length > 2) return null;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return Number(year) >= 1990 && Number(year) <= 2100 && isValidIsoDate(iso) ? iso : null;
}
