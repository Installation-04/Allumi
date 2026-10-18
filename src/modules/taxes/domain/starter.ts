import type { IsoDate } from "@/modules/ledger/client";

// The sales taxes of a business in Québec, with the rates published by Revenu Québec and the Canada Revenue Agency:
// GST 5 % since 2008-01-01, QST 9.975 % since 2013-01-01 (calculated on the price before GST, no tax on tax).
// Rates are data: they are checked against the official sources by the owner, and a change is a new rate with a date.

export type StarterTax = {
  code: string;
  nameFr: string;
  nameEn: string;
  rateMicro: bigint;
  from: IsoDate;
  /** The accounts of the starter chart (docs/Plan-comptable.md): payable (liability) and recoverable (asset). */
  payableAccount: { code: string; nameFr: string; nameEn: string };
  recoverableAccount: { code: string; nameFr: string; nameEn: string };
};

export const QUEBEC_TAXES: readonly StarterTax[] = [
  {
    code: "TPS",
    nameFr: "TPS",
    nameEn: "GST",
    rateMicro: 50_000n,
    from: "2008-01-01",
    payableAccount: { code: "2100", nameFr: "TPS à payer", nameEn: "GST payable" },
    recoverableAccount: { code: "1200", nameFr: "TPS à recevoir", nameEn: "GST receivable" },
  },
  {
    code: "TVQ",
    nameFr: "TVQ",
    nameEn: "QST",
    rateMicro: 99_750n,
    from: "2013-01-01",
    payableAccount: { code: "2110", nameFr: "TVQ à payer", nameEn: "QST payable" },
    recoverableAccount: { code: "1210", nameFr: "TVQ à recevoir", nameEn: "QST receivable" },
  },
];

export type TaxTreatment = "STANDARD" | "ZERO_RATED" | "EXEMPT" | "OUT_OF_SCOPE";

export type StarterTaxCode = { code: string; nameFr: string; nameEn: string; treatment: TaxTreatment; taxCodes: readonly string[] };

export const QUEBEC_TAX_CODES: readonly StarterTaxCode[] = [
  { code: "TPS-TVQ", nameFr: "TPS + TVQ", nameEn: "GST + QST", treatment: "STANDARD", taxCodes: ["TPS", "TVQ"] },
  { code: "TPS", nameFr: "TPS seulement", nameEn: "GST only", treatment: "STANDARD", taxCodes: ["TPS"] },
  { code: "DETAXE", nameFr: "Détaxé (0 %)", nameEn: "Zero-rated (0%)", treatment: "ZERO_RATED", taxCodes: [] },
  { code: "EXONERE", nameFr: "Exonéré", nameEn: "Exempt", treatment: "EXEMPT", taxCodes: [] },
  { code: "HORS-CHAMP", nameFr: "Hors champ", nameEn: "Out of scope", treatment: "OUT_OF_SCOPE", taxCodes: [] },
];
