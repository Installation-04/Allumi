// Calendar dates as ISO strings (YYYY-MM-DD): no time zone, so no off-by-one-day around midnight.
// Lexicographic order is chronological order.

export type IsoDate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = ISO.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

export function formatIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** First day of the month `months` months after the one containing `value`. */
export function addMonthsFirstDay(value: IsoDate, months: number): IsoDate {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new RangeError(`invalid date: ${value}`);
  const index = parsed.year * 12 + (parsed.month - 1) + months;
  return formatIsoDate(Math.floor(index / 12), (index % 12) + 1, 1);
}

export function lastDayOfMonth(value: IsoDate): IsoDate {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new RangeError(`invalid date: ${value}`);
  return formatIsoDate(parsed.year, parsed.month, daysInMonth(parsed.year, parsed.month));
}

/** The day after `value`. */
export function nextDay(value: IsoDate): IsoDate {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new RangeError(`invalid date: ${value}`);
  if (parsed.day < daysInMonth(parsed.year, parsed.month)) return formatIsoDate(parsed.year, parsed.month, parsed.day + 1);
  return addMonthsFirstDay(value, 1);
}
