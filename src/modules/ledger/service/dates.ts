import { isValidIsoDate, type IsoDate } from "../domain/dates";

/** Calendar date <-> the Date that Prisma uses for DATE columns (midnight UTC, so no day is lost to a time zone). */
export function toDbDate(iso: IsoDate): Date {
  // new Date("2026-02-30T00:00:00Z") is accepted and rolls over to March 2: refuse what is not a calendar date.
  if (!isValidIsoDate(iso)) throw new RangeError("not a calendar date");
  return new Date(`${iso}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** Today's date for the company. One time zone for the MVP (Eastern, where most Quebec businesses are). */
export const COMPANY_TIME_ZONE = "America/Toronto";

export function todayIso(now: Date = new Date()): IsoDate {
  // The "en-CA" locale writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: COMPANY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
