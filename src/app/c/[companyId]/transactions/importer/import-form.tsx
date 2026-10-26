"use client";

import { useId, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { formatMoney } from "@/modules/ledger/client";
import { decodeStatement, MAX_STATEMENT_BYTES, readStatement, StatementError, type CsvMapping, type ReadStatement } from "@/modules/banking/client";
import { importStatementAction } from "../actions";

type AccountOption = { id: string; label: string };
type Read = { ok: true; value: ReadStatement } | { ok: false; code: string };

const CONTROL = `min-h-11 min-w-0 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base shadow-sm dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
const BLANK: CsvMapping = { hasHeader: true, dateColumn: 0, dateOrder: "YMD", descriptionColumns: [1], payeeColumn: null, amount: { kind: "single", column: 2 }, decimal: ".", invertSign: false };

const tryRead = (text: string, mapping?: CsvMapping | null): Read => {
  try {
    return { ok: true, value: readStatement(text, mapping ? { mapping } : {}) };
  } catch (error) {
    return { ok: false, code: error instanceof StatementError ? error.code : "unreadable" };
  }
};

function Pick(props: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{props.label}</label>
      <select id={id} value={props.value} onChange={(event) => props.onChange(event.target.value)} className={CONTROL}>
        {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {props.hint ? <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">{props.hint}</p> : null}
    </div>
  );
}

/**
 * The form to import a statement. The browser reads the file with the same code the server will use (so what the
 * person sees is what will be read), lets them choose the columns of a CSV, and shows the first lines and the totals.
 * Nothing is stored until the form is submitted, and the server reads the file again.
 */
export function ImportForm({ companyId, accounts, saved }: { companyId: string; accounts: AccountOption[]; saved: Record<string, CsvMapping | null> }) {
  const t = useTranslations("banking");
  const te = useTranslations("errors");
  const locale = useLocale() === "en" ? "en" : "fr-CA";
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [text, setText] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [edited, setEdited] = useState<CsvMapping | null>(null);
  const fileId = useId();
  const accountField = useId();

  const first = useMemo(() => (text === null ? null : tryRead(text)), [text]);
  const table = first?.ok ? first.value.table : null;
  // The mapping in use: the person's edits, else the one this account used last time if it reads this file without a
  // single unreadable row (another bank's file, or a new layout, does not), else the suggestion.
  const remembered = saved[accountId] ?? null;
  const rememberedFits = useMemo(() => {
    if (text === null || !table || !remembered) return false;
    const attempt = tryRead(text, remembered);
    return attempt.ok && attempt.value.errorCount === 0 && attempt.value.lines.length > 0;
  }, [text, table, remembered]);
  const effective: CsvMapping | null = table ? (edited ?? (rememberedFits ? remembered : first?.ok ? first.value.mapping : null)) : null;
  const read: Read | null = useMemo(() => (text === null || first === null ? null : first.ok && first.value.format === "CSV" && effective ? tryRead(text, effective) : first), [text, first, effective]);
  const value = read?.ok ? read.value : null;
  const width = table ? Math.max(...table.map((row) => row.length)) : 0;
  const sample = (index: number) => (table?.[effective?.hasHeader ? 0 : 1]?.[index] ?? table?.[0]?.[index] ?? "").slice(0, 24);
  const columns = Array.from({ length: width }, (_, index) => ({ value: String(index), label: t("column", { n: index + 1, sample: sample(index) }) }));
  const draft = effective ?? BLANK;
  const change = (patch: Partial<CsvMapping>) => setEdited({ ...draft, ...patch });

  const inflow = value?.lines.reduce((sum, line) => (line.amountCents > 0n ? sum + line.amountCents : sum), 0n) ?? 0n;
  const outflow = value?.lines.reduce((sum, line) => (line.amountCents < 0n ? sum - line.amountCents : sum), 0n) ?? 0n;
  const dates = value?.lines.map((line) => line.date).sort() ?? [];

  async function onFile(file: File | undefined) {
    setEdited(null);
    setTooLarge(false);
    if (!file) return setText(null);
    if (file.size > MAX_STATEMENT_BYTES) {
      setText(null);
      return setTooLarge(true);
    }
    try {
      setText(decodeStatement(new Uint8Array(await file.arrayBuffer())));
    } catch {
      setText("");
    }
  }

  if (accounts.length === 0) return <p className="rounded border border-amber-600 p-3 text-sm">{t("noAccounts")}</p>;
  return (
    <ActionForm action={importStatementAction.bind(null, companyId)} label={t("submit")} variant="primary" preserveOnReset>
      <div>
        <label htmlFor={accountField} className="mb-1 block text-sm font-medium">{t("accountField")}</label>
        <select id={accountField} name="accountId" value={accountId} onChange={(event) => { setAccountId(event.target.value); setEdited(null); }} className={CONTROL} aria-describedby={`${accountField}-hint`}>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select>
        <p id={`${accountField}-hint`} className="mt-1 text-xs text-stone-600 dark:text-stone-400">{t("accountHint")}</p>
      </div>
      <div>
        <label htmlFor={fileId} className="mb-1 block text-sm font-medium">{t("fileField")}</label>
        <input id={fileId} name="file" type="file" required accept=".csv,.ofx,.qfx,.txt,text/csv,application/x-ofx" onChange={(event) => void onFile(event.target.files?.[0])} className={`${CONTROL} file:mr-3`} aria-describedby={`${fileId}-hint`} />
        <p id={`${fileId}-hint`} className="mt-1 text-xs text-stone-600 dark:text-stone-400">{t("fileHint")}</p>
      </div>
      <input type="hidden" name="mapping" value={value?.format === "CSV" && effective ? JSON.stringify(effective) : ""} />

      <div aria-live="polite" className="space-y-3">
        {tooLarge ? <p role="alert" className="rounded border border-red-600 p-3 text-sm">{te("banking.tooLarge")}</p> : null}
        {read && !read.ok ? <p role="alert" className="rounded border border-red-600 p-3 text-sm">{te(`banking.${read.code}` as "banking.empty")}</p> : null}
        {value ? (
          <section className="space-y-3 rounded border border-stone-300 p-4 dark:border-stone-700" aria-labelledby={`${fileId}-preview`}>
            <h2 id={`${fileId}-preview`} className="font-semibold">{t("previewTitle")}</h2>
            <p className="text-sm">{t("format", { format: value.format })}</p>
            {value.format === "OFX" ? (
              <p className="text-sm break-words">
                {t("ofxInfo", { currency: value.currency ?? "—", mask: value.accountMask ?? "—", balance: value.ledgerBalance ? formatMoney(value.ledgerBalance.cents, locale) : "—", date: value.ledgerBalance?.date ?? "—" })}
              </p>
            ) : null}
            {value.format === "CSV" && !value.mapping ? <p role="note" className="text-sm">{t("noMapping")}</p> : null}
            {value.lines.length > 0 ? (
              <>
                <p className="text-sm tabular-nums">{t("summary", { count: value.lines.length, from: dates[0] ?? "", to: dates[dates.length - 1] ?? "", inflow: formatMoney(inflow, locale), outflow: formatMoney(outflow, locale) })}</p>
                <ul className="space-y-1">
                  {value.lines.slice(0, 8).map((line) => (
                    <li key={line.dedupeKey} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="min-w-0 break-words">{line.date} · {line.description}</span>
                      <span className="tabular-nums">{formatMoney(line.amountCents, locale)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : value.mapping || value.format === "OFX" ? <p className="text-sm">{t("none")}</p> : null}
            {value.skipped > 0 ? <p className="text-sm text-stone-600 dark:text-stone-400">{t("skipped", { count: value.skipped })}</p> : null}
            {value.errorCount > 0 ? (
              <div role="alert" className="space-y-1 rounded border border-red-600 p-3 text-sm">
                <p>{t("errorsTitle", { count: value.errorCount })}</p>
                {value.errors.length > 0 ? <p className="text-xs">{value.errors.map((error) => t("rowError", { row: error.row, problem: t(`problems.${error.code}`) })).join(" · ")}</p> : null}
              </div>
            ) : null}
          </section>
        ) : null}
        {value?.format === "CSV" && table ? (
          <fieldset className="space-y-3 rounded border border-stone-300 p-4 dark:border-stone-700">
            <legend className="px-1 font-semibold">{t("mappingTitle")}</legend>
            <label className="inline-flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.hasHeader} onChange={(event) => change({ hasHeader: event.target.checked })} />{t("hasHeader")}</label>
            <Pick label={t("dateColumn")} value={String(draft.dateColumn)} onChange={(v) => change({ dateColumn: Number(v) })} options={columns} />
            <Pick label={t("dateOrder")} value={draft.dateOrder} onChange={(v) => change({ dateOrder: v as CsvMapping["dateOrder"] })} options={(["YMD", "DMY", "MDY"] as const).map((order) => ({ value: order, label: t(`dateOrders.${order}`) }))} />
            <Pick label={t("descriptionColumn")} value={String(draft.descriptionColumns[0] ?? 0)} onChange={(v) => change({ descriptionColumns: [Number(v), ...draft.descriptionColumns.slice(1)] })} options={columns} />
            <Pick
              label={t("descriptionExtra")} value={draft.descriptionColumns[1] === undefined ? "" : String(draft.descriptionColumns[1])}
              onChange={(v) => change({ descriptionColumns: v === "" ? draft.descriptionColumns.slice(0, 1) : [draft.descriptionColumns[0] ?? 0, Number(v)] })}
              options={[{ value: "", label: t("noColumn") }, ...columns]}
            />
            <Pick
              label={t("amountKind")} value={draft.amount.kind}
              onChange={(v) => change({ amount: v === "split" ? { kind: "split", outColumn: Math.min(2, width - 1), inColumn: Math.min(3, width - 1) } : { kind: "single", column: Math.min(2, width - 1) } })}
              options={(["single", "split"] as const).map((kind) => ({ value: kind, label: t(`amountKinds.${kind}`) }))}
            />
            {draft.amount.kind === "single" ? (
              <Pick label={t("amountColumn")} value={String(draft.amount.column)} onChange={(v) => change({ amount: { kind: "single", column: Number(v) } })} options={columns} />
            ) : (
              <>
                <Pick label={t("outColumn")} value={String(draft.amount.outColumn)} onChange={(v) => change({ amount: { kind: "split", outColumn: Number(v), inColumn: draft.amount.kind === "split" ? draft.amount.inColumn : 0 } })} options={columns} />
                <Pick label={t("inColumn")} value={String(draft.amount.inColumn)} onChange={(v) => change({ amount: { kind: "split", outColumn: draft.amount.kind === "split" ? draft.amount.outColumn : 0, inColumn: Number(v) } })} options={columns} />
              </>
            )}
            <Pick label={t("decimal")} value={draft.decimal} onChange={(v) => change({ decimal: v as CsvMapping["decimal"] })} options={([".", ","] as const).map((mark) => ({ value: mark, label: t(mark === "." ? "decimals.point" : "decimals.comma") }))} />
            <label className="inline-flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.invertSign} onChange={(event) => change({ invertSign: event.target.checked })} />{t("invert")}</label>
          </fieldset>
        ) : null}
      </div>
    </ActionForm>
  );
}
