"use client";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { PAYMENT_METHODS } from "@/modules/payments/client";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import type { DraftLineInput } from "@/modules/purchases/client";
import { saveExpenseDraftAction } from "./actions";
type Option = { value: string; label: string };
type Item = { id: string; name: string; unitPrice: string; accountId: string; taxCodeId: string };
const blank = (): DraftLineInput => ({ itemId: "", description: "", quantity: "1", unitPrice: "0", accountId: "", taxCodeId: "" });
export function DraftForm({ companyId, id = null, initial, contacts, accounts, codes, items, paymentAccounts }: { companyId: string; id?: string | null; initial: { contactId?: string; documentDate: string; dueDate?: string; paymentAccountId?: string; paymentMethod?: string; supplierReference?: string; memo?: string; revision?: string; lines?: DraftLineInput[] }; contacts: Option[]; accounts: Option[]; codes: Option[]; items: Item[]; paymentAccounts: Option[] }) {
  const t = useTranslations("expenses");
  const formId = useId();
  const [lines, setLines] = useState<DraftLineInput[]>(initial.lines ?? [blank()]);
  const update = (index: number, patch: Partial<DraftLineInput>) => setLines(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const control = "mt-1 block min-h-11 w-full min-w-0 rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900";
  const select = (index: number, key: "accountId" | "taxCodeId", options: Option[], label: string) => <label className="min-w-0" htmlFor={`${formId}-${index}-${key}`}>{label}<select required className={control} id={`${formId}-${index}-${key}`} value={lines[index]?.[key]} onChange={e => update(index, { [key]: e.target.value })}><option value="">{t("choose")}</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
  return <ActionForm action={saveExpenseDraftAction.bind(null, companyId, id)} label={t("save")} variant="primary" preserveOnReset>
    <input type="hidden" name="revision" value={initial.revision ?? ""} /><input type="hidden" name="lines" value={JSON.stringify(lines)} />
    <div className="grid gap-4 sm:grid-cols-2"><SelectField name="contactId" label={t("supplier")} defaultValue={initial.contactId} options={[{ value: "", label: t("choose") }, ...contacts]} /><Field name="supplierReference" label={t("supplierReference")} defaultValue={initial.supplierReference} required={false} /><Field name="documentDate" label={t("date")} type="date" defaultValue={initial.documentDate} /><SelectField name="paymentAccountId" label={t("paymentAccount")} defaultValue={initial.paymentAccountId} options={[{value:"",label:t("choose")},...paymentAccounts]} /><SelectField name="paymentMethod" label={t("paymentMethod")} defaultValue={initial.paymentMethod ?? "EFT"} options={PAYMENT_METHODS.map(value => ({value,label:t(`methods.${value}`)}))} /></div>
    <p className="text-sm text-stone-600 dark:text-stone-400">{t("lineHint")}</p>
    {lines.map((line, i) => <fieldset key={i} className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-700"><legend className="px-2 font-semibold">{t("line", { n: i + 1 })}</legend>
      <label className="block" htmlFor={`${formId}-${i}-item`}>{t("item")}<select id={`${formId}-${i}-item`} className={control} value={line.itemId} onChange={e => { const item = items.find(item => item.id === e.target.value); update(i, item ? { itemId: item.id, description: item.name, unitPrice: item.unitPrice, accountId: item.accountId, taxCodeId: item.taxCodeId } : { itemId: "" }); }}><option value="">{t("manual")}</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2">{(["description", "quantity", "unitPrice"] as const).map(key => <label key={key} className="min-w-0" htmlFor={`${formId}-${i}-${key}`}>{t(key)}<input id={`${formId}-${i}-${key}`} className={control} required maxLength={key === "description" ? 500 : 20} inputMode={key === "description" ? "text" : "decimal"} value={line[key]} onChange={e => update(i, { [key]: e.target.value })} /></label>)}{select(i, "accountId", accounts, t("account"))}{select(i, "taxCodeId", codes, t("taxCode"))}</div>
      <button type="button" className="min-h-11 rounded border px-4 disabled:opacity-50" disabled={lines.length === 1} onClick={() => setLines(rows => rows.filter((_, index) => index !== i))}>{t("remove", { n: i + 1 })}</button>
    </fieldset>)}
    <button type="button" className="min-h-11 rounded border px-4 disabled:opacity-50" disabled={lines.length >= 50} onClick={() => setLines(rows => [...rows, blank()])}>{t("add")}</button>
    <Field name="memo" label={t("memo")} defaultValue={initial.memo} required={false} />
    <p className="text-sm">{t("saveHint")}</p>
  </ActionForm>;
}
