"use client";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { calculateTaxes, decimalUnits, effectiveRate, type DatedRate } from "@/modules/taxes/client";
import { formatMoney, isValidIsoDate, type Locale } from "@/modules/ledger/client";

export function TaxPreview({ codes, taxes, today, locale }: { codes: { id: string; label: string; taxIds: string[] }[]; taxes: { id: string; code: string; rates: DatedRate[] }[]; today: string; locale: Locale }) {
  const t = useTranslations("catalog");
  const id = useId();
  const [codeId, setCode] = useState(codes[0]?.id ?? "");
  const [price, setPrice] = useState("100");
  const [quantity, setQuantity] = useState("1");
  const [date, setDate] = useState(today);
  let result = null;
  try {
    const code = codes.find((c) => c.id === codeId);
    const unitPrice = price.replace(",", ".");
    const units = quantity.replace(",", ".");
    if (!isValidIsoDate(date) || !code || decimalUnits(unitPrice) < 0n || decimalUnits(units) <= 0n) throw new Error("Invalid preview");
    result = calculateTaxes([{ unitPrice, quantity: units, taxes: code.taxIds.map((taxId) => { const tax = taxes.find((tax) => tax.id === taxId); if (!tax) throw new Error("Missing tax"); return { id: taxId, rate: effectiveRate(tax.rates, date) }; }) }], "PER_LINE");
  } catch { /* A missing effective rate must never silently become zero tax. */ }
  const control = "mt-1 block min-h-11 w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900";
  return <section className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="text-lg font-semibold">{t("preview")}</h2><p className="text-sm">{t("previewHint")}</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label htmlFor={`${id}-code`}>{t("taxCode")}<select id={`${id}-code`} className={control} value={codeId} onChange={(e) => setCode(e.target.value)}><option value="">{t("none")}</option>{codes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label htmlFor={`${id}-price`}>{t("unitPrice")}<input id={`${id}-price`} className={control} inputMode="decimal" maxLength={20} value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label htmlFor={`${id}-quantity`}>{t("quantity")}<input id={`${id}-quantity`} className={control} inputMode="decimal" maxLength={20} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
      <label htmlFor={`${id}-date`}>{t("previewDate")}<input id={`${id}-date`} className={control} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    </div>
    <div role="status" className="space-y-1 tabular-nums">{result ? <><p>{t("subtotal")}: {formatMoney(result.subtotalCents, locale)}</p>{result.taxes.map((tax) => <p key={tax.id}>{taxes.find((row) => row.id === tax.id)?.code}: {formatMoney(tax.amountCents, locale)}</p>)}<p className="font-semibold">{t("total")}: {formatMoney(result.totalCents, locale)}</p></> : <p>{t("previewUnavailable")}</p>}</div>
  </section>;
}
