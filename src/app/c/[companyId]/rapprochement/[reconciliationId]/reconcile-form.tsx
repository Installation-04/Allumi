"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { formatMoney } from "@/modules/ledger/client";
import { saveAction } from "../actions";

export type SheetLine = {
  lineId: string;
  /** The entry as the journal writes it, with its date and what it says. */
  label: string;
  /** Debit − credit on the account, in cents, as a decimal string. */
  cents: string;
  cleared: boolean;
  /** The statement line it is matched to. */
  transaction: string | null;
  reversed: boolean;
};

const BUTTON = `min-h-11 rounded-md border border-stone-300 px-4 py-2 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`;

/**
 * The lines of the account that a statement could count, each with a check box, and the running figures: the
 * statement's balance, what is counted (the earlier statements' lines and the ticked ones) and the difference, which
 * is what is left to explain. A card's figures are read the way its statement reads them (what is owed). Saving
 * keeps exactly the ticked lines; the server and the database check the balance again when the reconciliation is completed.
 */
export function ReconcileForm(props: { companyId: string; reconciliationId: string; sign: 1 | -1; statementLedger: string; previous: string; lines: SheetLine[] }) {
  const t = useTranslations("reconciliation");
  const locale = useLocale() === "en" ? "en" : "fr-CA";
  const initial = props.lines.filter((line) => line.cleared).map((line) => line.lineId);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set(initial));
  // What the server holds changed (a save, or the matched lines ticked by the other button): the sheet follows it, and the form itself stays, so its answer is not lost.
  const saved = initial.join(",");
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setTicked(new Set(initial));
  }
  const summary = useId();
  const sign = BigInt(props.sign);
  const sum = props.lines.filter((line) => ticked.has(line.lineId)).reduce((total, line) => total + BigInt(line.cents), 0n);
  const counted = BigInt(props.previous) + sum;
  const difference = BigInt(props.statementLedger) - counted;
  const dirty = ticked.size !== initial.length || initial.some((id) => !ticked.has(id));
  const toggle = (id: string) => setTicked((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  return (
    <ActionForm action={saveAction.bind(null, props.companyId, props.reconciliationId)} label={t("save")} savedMessage={t("saved")} variant="primary" preserveOnReset>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} onClick={() => setTicked(new Set(props.lines.map((line) => line.lineId)))}>{t("tickAll")}</button>
        <button type="button" className={BUTTON} onClick={() => setTicked(new Set())}>{t("tickNone")}</button>
      </div>
      <fieldset aria-describedby={summary} className="min-w-0 space-y-2">
        <legend className="sr-only">{t("linesLegend")}</legend>
        {props.lines.map((line) => (
          <label key={line.lineId} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded border border-stone-300 p-3 text-sm dark:border-stone-700 ${ticked.has(line.lineId) ? "bg-stone-100 dark:bg-stone-800" : ""}`}>
            <input type="checkbox" name="line" value={line.lineId} checked={ticked.has(line.lineId)} onChange={() => toggle(line.lineId)} className={`mt-1 size-5 shrink-0 ${FOCUS}`} />
            <span className="min-w-0 flex-1 break-words">
              {line.label}
              {line.transaction ? ` · ${t("matchedTo", { description: line.transaction })}` : ""}
              {line.reversed ? ` · ${t("reversed")}` : ""}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{formatMoney(BigInt(line.cents), locale)}</span>
          </label>
        ))}
      </fieldset>
      <p id={summary} role="status" className="text-sm tabular-nums">
        {t("statementBalance")} {formatMoney(sign * BigInt(props.statementLedger), locale)} · {t("counted")} {formatMoney(sign * counted, locale)} ·{" "}
        <span className={difference === 0n ? "font-semibold text-brand-700 dark:text-brand-500" : ""}>{difference === 0n ? t("balanced") : `${t("difference")} ${formatMoney(sign * difference, locale)}`}</span>
        {dirty ? <span className="block">{t("unsaved")}</span> : null}
      </p>
    </ActionForm>
  );
}
