"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Field, SelectField, StateError, SubmitButton } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { checkEntry, formatMoney, parseMoney, type Locale } from "@/modules/ledger/client";
import { postEntryAction } from "../actions";

type Row = { key: number; accountId: string; debit: string; credit: string; note: string };
export type AccountOption = { id: string; label: string };

const blank = (key: number): Row => ({ key, accountId: "", debit: "", credit: "", note: "" });
const CELL = `w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-base dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;

export function EntryForm({ companyId, accounts, locale, today }: { companyId: string; accounts: AccountOption[]; locale: Locale; today: string }) {
  const t = useTranslations("entry");
  const [state, action] = useActionState(postEntryAction.bind(null, companyId), undefined);
  const [rows, setRows] = useState<Row[]>([blank(1), blank(2)]);

  const update = (key: number, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  // Amounts as the server will read them; an unreadable amount keeps the form from being declared balanced.
  const parsed = rows.map((row) => {
    const debit = row.debit.trim() === "" ? 0n : parseMoney(row.debit, locale);
    const credit = row.credit.trim() === "" ? 0n : parseMoney(row.credit, locale);
    return { row, debit, credit };
  });
  const readable = parsed.every((line) => line.debit !== null && line.credit !== null);
  const used = parsed.filter((line) => line.row.accountId !== "" || (line.debit ?? 0n) !== 0n || (line.credit ?? 0n) !== 0n);
  const totalDebit = used.reduce((sum, line) => sum + (line.debit ?? 0n), 0n);
  const totalCredit = used.reduce((sum, line) => sum + (line.credit ?? 0n), 0n);
  const problems = checkEntry(used.map((line) => ({ accountId: line.row.accountId || "x", debitCents: line.debit ?? 0n, creditCents: line.credit ?? 0n })));
  const missingAccount = used.some((line) => line.row.accountId === "");
  const ready = readable && !missingAccount && problems.length === 0;
  const difference = totalDebit - totalCredit;

  return (
    <form action={action} className="space-y-6">
      <StateError state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="date" type="date" label={t("date")} defaultValue={today} />
        <SelectField
          name="kind"
          label={t("kind")}
          options={[
            { value: "MANUAL", label: t("kindManual") },
            { value: "OPENING_BALANCE", label: t("kindOpening") },
          ]}
        />
        <Field name="memo" label={t("memo")} required={false} autoComplete="off" />
      </div>
      <p className="text-sm text-stone-700 dark:text-stone-300">{t("openingHint")}</p>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">{t("lines")}</legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-1 py-1 text-left font-medium">{t("account")}</th>
                <th scope="col" className="px-1 py-1 text-left font-medium">{t("debit")}</th>
                <th scope="col" className="px-1 py-1 text-left font-medium">{t("credit")}</th>
                <th scope="col" className="px-1 py-1 text-left font-medium">{t("note")}</th>
                <th scope="col" className="px-1 py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key}>
                  <td className="px-1 py-1">
                    <select aria-label={`${t("line", { number: index + 1 })} – ${t("account")}`} name="lineAccount" value={row.accountId} onChange={(event) => update(row.key, { accountId: event.target.value })} className={CELL}>
                      <option value="">{t("choose")}</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input aria-label={`${t("line", { number: index + 1 })} – ${t("debit")}`} name="lineDebit" inputMode="decimal" autoComplete="off" value={row.debit} onChange={(event) => update(row.key, { debit: event.target.value })} className={`${CELL} text-right tabular-nums`} />
                  </td>
                  <td className="px-1 py-1">
                    <input aria-label={`${t("line", { number: index + 1 })} – ${t("credit")}`} name="lineCredit" inputMode="decimal" autoComplete="off" value={row.credit} onChange={(event) => update(row.key, { credit: event.target.value })} className={`${CELL} text-right tabular-nums`} />
                  </td>
                  <td className="px-1 py-1">
                    <input aria-label={`${t("line", { number: index + 1 })} – ${t("note")}`} name="lineNote" autoComplete="off" value={row.note} onChange={(event) => update(row.key, { note: event.target.value })} className={CELL} />
                  </td>
                  <td className="px-1 py-1">
                    {rows.length > 2 ? (
                      <button type="button" onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))} className={`rounded-md border border-stone-300 px-2 py-1 dark:border-stone-700 ${FOCUS}`}>
                        <span aria-hidden="true">×</span>
                        <span className="sr-only">{t("removeLine", { number: index + 1 })}</span>
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="px-1 py-2 text-left">{t("totals")}</th>
                <td className="px-1 py-2 text-right tabular-nums">{formatMoney(totalDebit, locale)}</td>
                <td className="px-1 py-2 text-right tabular-nums">{formatMoney(totalCredit, locale)}</td>
                <td colSpan={2} className="px-1 py-2" aria-live="polite">
                  {ready ? t("balanced") : difference !== 0n ? t("difference", { amount: formatMoney(difference < 0n ? -difference : difference, locale) }) : null}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <button
          type="button"
          onClick={() => setRows((current) => [...current, blank(Math.max(...current.map((row) => row.key)) + 1)])}
          className={`rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}
        >
          {t("addLine")}
        </button>
      </fieldset>

      <p className="text-sm text-stone-700 dark:text-stone-300">{t("immutable")}</p>
      <SubmitButton variant="primary">{t("submit")}</SubmitButton>
    </form>
  );
}
