"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { formatMoney } from "@/modules/ledger/client";
import { MAX_MATCHED_LINES } from "@/modules/banking/client";
import { matchAction } from "../actions";

export type Candidate = {
  lineId: string;
  /** The entry as the journal writes it, with its date and what it says. */
  label: string;
  /** Debit − credit on the account, in cents, as a decimal string. */
  cents: string;
  reversed: boolean;
  reconciled: boolean;
};

/**
 * The lines of the journal that could be this transaction, each with a check box, and the running total against the
 * transaction's amount: the person sees how far off they are before sending. The server checks the total again, and
 * so does the database.
 */
export function MatchPicker({ companyId, transactionId, target, candidates }: { companyId: string; transactionId: string; target: string; candidates: Candidate[] }) {
  const t = useTranslations("transactionDetail");
  const locale = useLocale() === "en" ? "en" : "fr-CA";
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const legend = useId();
  const goal = BigInt(target);
  const total = candidates.filter((candidate) => picked.has(candidate.lineId)).reduce((sum, candidate) => sum + BigInt(candidate.cents), 0n);
  const gap = goal - total;
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  return (
    <ActionForm action={matchAction.bind(null, companyId, transactionId)} label={t("matchSubmit")} variant="primary" preserveOnReset>
      <fieldset aria-describedby={legend} className="min-w-0 space-y-2">
        <legend className="sr-only">{t("matchLegend")}</legend>
        {candidates.map((candidate) => (
          <label key={candidate.lineId} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded border border-stone-300 p-3 text-sm dark:border-stone-700 ${picked.has(candidate.lineId) ? "bg-stone-100 dark:bg-stone-800" : ""}`}>
            <input
              type="checkbox"
              name="line"
              value={candidate.lineId}
              checked={picked.has(candidate.lineId)}
              disabled={!picked.has(candidate.lineId) && picked.size >= MAX_MATCHED_LINES}
              onChange={() => toggle(candidate.lineId)}
              className={`mt-1 size-5 shrink-0 ${FOCUS}`}
            />
            <span className="min-w-0 flex-1 break-words">
              {candidate.label}
              {candidate.reversed ? ` · ${t("reversed")}` : ""}
              {candidate.reconciled ? ` · ${t("reconciled")}` : ""}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{formatMoney(BigInt(candidate.cents), locale)}</span>
          </label>
        ))}
      </fieldset>
      <p id={legend} role="status" className="text-sm tabular-nums">
        {t("picked", { count: picked.size })} · {t("total")} {formatMoney(total, locale)} · {t("target")} {formatMoney(goal, locale)} ·{" "}
        <span className={gap === 0n && picked.size > 0 ? "font-semibold text-brand-700 dark:text-brand-500" : ""}>{gap === 0n && picked.size > 0 ? t("balanced") : `${t("gap")} ${formatMoney(gap, locale)}`}</span>
      </p>
    </ActionForm>
  );
}
