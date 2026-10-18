import { z } from "zod";

// Registration numbers, as the database stores them (no spaces): the GST/HST number is nine digits, "RT", four digits;
// the QST number ten digits, "TQ", four digits; the Québec enterprise number (NEQ) ten digits; the federal business number nine.
const GST = /^[0-9]{9}RT[0-9]{4}$/;
const QST = /^[0-9]{10}TQ[0-9]{4}$/;
const NEQ = /^[0-9]{10}$/;
const BUSINESS_NUMBER = /^[0-9]{9}$/;

/** What people type: spaces, dots and hyphens, any case. */
export function cleanRegistrationNumber(raw: string): string {
  return raw.replace(/[\s.\-]/g, "").toUpperCase();
}

export const isGstNumber = (value: string): boolean => GST.test(value);
export const isQstNumber = (value: string): boolean => QST.test(value);

/** "123456789RT0001" -> "123456789 RT 0001", the way it is printed on a document. */
export function formatGstNumber(value: string): string {
  return GST.test(value) ? `${value.slice(0, 9)} ${value.slice(9, 11)} ${value.slice(11)}` : value;
}

/** "1234567890TQ0001" -> "1234567890 TQ 0001". */
export function formatQstNumber(value: string): string {
  return QST.test(value) ? `${value.slice(0, 10)} ${value.slice(10, 12)} ${value.slice(12)}` : value;
}

/** An optional number: empty means none; anything else must match the format once cleaned. */
function optionalNumber(pattern: RegExp) {
  return z
    .string()
    .nullish()
    .transform((value) => (value == null ? null : cleanRegistrationNumber(value)))
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || pattern.test(value), { message: "registrationNumber" });
}

export const gstNumberSchema = optionalNumber(GST);
export const qstNumberSchema = optionalNumber(QST);
export const neqSchema = optionalNumber(NEQ);
export const businessNumberSchema = optionalNumber(BUSINESS_NUMBER);

// Canadian postal codes never use the letters D, F, I, O, Q, U; W and Z are not used to start one.
const POSTAL = /^[ABCEGHJKLMNPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z][0-9][ABCEGHJ-NPRSTV-Z][0-9]$/;

/** "h2x1y4" -> "H2X 1Y4", or null if it is not a Canadian postal code. */
export function normalizePostalCode(raw: string): string | null {
  const compact = raw.replace(/[\s-]/g, "").toUpperCase();
  return POSTAL.test(compact) ? `${compact.slice(0, 3)} ${compact.slice(3)}` : null;
}
