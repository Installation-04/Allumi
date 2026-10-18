"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Field, FormScopeProvider, SelectField, StateError, SubmitButton, useScopedAction } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { checkEntry, formatMoney, parseMoney, type Locale } from "@/modules/ledger/client";
import { postEntryAction } from "../actions";

type Row = { key: number; accountId: string; debit: string; credit: string; note: string };
export type AccountOption = { id: string; label: string };

const blank = (key: number): Row => ({ key, accountId: "", debit: "", credit: "", note: "" });
const CELL = `w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-base dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;

export function EntryForm({ companyId, accounts, locale, today }: { companyId: string; accounts: AccountOption[]; locale: Locale; today: string }) {
  const t = useTranslations("entry");
  const { state, formAction: action, scope } = useScopedAction(postEntryAction.bind(null, companyId));
  const [rows, setRows] = useState<Row[]>([blank(1), blank(2)]);
  const ids = useId();
  // Where the keyboard goes after the row list changes: the new row, or the add button when a row disappears.
  const focusRow = useRef<number | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  const accountId = (key: number) => `${ids}-account-${key}`;

  useEffect(() => {
    if (focusRow.current !== null) document.getElementById(accountId(focusRow.current))?.focus();
    focusRow.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the list of rows moves the focus
  }, [rows.length]);
  // A refusal is announced and brought into view: the message is at the top of a long form, the button at the bottom.
  useEffect(() => {
    if (state?.error || state?.messageKey) errorBox.current?.focus();
  }, [state]);

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
  // What keeps the entry from being saved, said next to the totals (the live region announces it).
  const firstProblem = problems.find((problem) => problem.code !== "unbalanced");
  const hint = !readable
    ? t("problems.unreadable")
    : used.length === 0
      ? null
      : missingAccount
        ? t("problems.missingAccount")
        : firstProblem
          ? t(`problems.${firstProblem.code}`, { line: "line" in firstProblem ? firstProblem.line : 0 })
          : null;

  return (
    <form action={action} className="space-y-6">
      <div ref={errorBox} tabIndex={-1} className="outline-none">
        <StateError state={state} />
      </div>
      <FormScopeProvider scope={scope}>
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
      </FormScopeProvider>
      <p className="text-sm text-stone-700 dark:text-stone-300">{t("openingHint")}</p>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">{t("lines")}</legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">{t("lines")}</caption>
            <thead>
              <tr>
                <th scope="col" className="px-1 py-1 text-left font-medium">{t("account")}</th>
                <th scope="col" className="px-1 py-1 text-left font-medium">{t("debit")}</th>
                <th scope="col" className="px-1 py-1 text-left font-medium">{t("credit")}</th>
                <th scope="col" className="px-1 py-1 text-left font-medium">{t("note")}</th>
                <th scope="col" className="px-1 py-1"><span className="sr-only">{t("actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key}>
                  <td className="px-1 py-1">
                    <select key={`${row.key}-${scope.attempt}`} id={accountId(row.key)} aria-label={`${t("line", { number: index + 1 })} – ${t("account")}`} name="lineAccount" defaultValue={row.accountId} onChange={(event) => update(row.key, { accountId: event.target.value })} className={CELL}>
                      <option value="">{t("choose")}</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input aria-invalid={parsed[index]?.debit === null} aria-label={`${t("line", { number: index + 1 })} – ${t("debit")}`} name="lineDebit" inputMode="decimal" autoComplete="off" value={row.debit} onChange={(event) => update(row.key, { debit: event.target.value })} className={`${CELL} text-right tabular-nums`} />
                  </td>
                  <td className="px-1 py-1">
                    <input aria-invalid={parsed[index]?.credit === null} aria-label={`${t("line", { number: index + 1 })} – ${t("credit")}`} name="lineCredit" inputMode="decimal" autoComplete="off" value={row.credit} onChange={(event) => update(row.key, { credit: event.target.value })} className={`${CELL} text-right tabular-nums`} />
                  </td>
                  <td className="px-1 py-1">
                    <input aria-label={`${t("line", { number: index + 1 })} – ${t("note")}`} name="lineNote" autoComplete="off" value={row.note} onChange={(event) => update(row.key, { note: event.target.value })} className={CELL} />
                  </td>
                  <td className="px-1 py-1">
                    {rows.length > 2 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRows((current) => current.filter((candidate) => candidate.key !== row.key));
                          addButton.current?.focus();
                        }}
                        className={`rounded-md border border-stone-300 px-2 py-1 dark:border-stone-700 ${FOCUS}`}
                      >
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
                  {ready
                    ? t("balanced")
                    : hint
                      ? hint
                      : difference !== 0n
                        ? t("difference", { amount: formatMoney(difference < 0n ? -difference : difference, locale) })
                        : null}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <button
          ref={addButton}
          type="button"
          onClick={() => {
            const key = Math.max(...rows.map((row) => row.key)) + 1;
            focusRow.current = key;
            setRows((current) => [...current, blank(key)]);
          }}
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
