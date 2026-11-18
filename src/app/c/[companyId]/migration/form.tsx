"use client";
import { useActionState, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "@/platform/i18n/client";
import { decodeMigrationCsv, readMigrationCsv, suggestMapping, fieldsFor, prepareMigration, MigrationCsvError, MAX_MIGRATION_BYTES, type MigrationSpec, FIELDS, type MigrationKind, type MigrationField } from "@/modules/migration/client";
import { formatMoney } from "@/modules/ledger/client";
import { FOCUS } from "@/app/_components/focus";
import { migrationAction, type MigrationActionState } from "./actions";
const INPUT = `min-h-11 min-w-0 w-full rounded-md border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
const BUTTON = `min-h-11 rounded-md border border-stone-300 px-4 py-2 text-sm dark:border-stone-700 ${FOCUS}`;
export function MigrationForm({ companyId, kinds }: { companyId: string; kinds: MigrationKind[] }) {
  const locale = useLocale(), t = useTranslations("migration"), errors = useTranslations("errors"), enums = useTranslations("enums");
  const [spec, setSpec] = useState<MigrationSpec>({ source: "ONLINE", kind: kinds[0]!, delimiter: ",", format: "en", headerRecord: 1, mapping: {}, defaultLocale: locale === "en" ? "en" : "fr_CA", skipExisting: false, cutoverDate: "" });
  const [file, setFile] = useState<{ text: string; generation: number } | null>(null), [fileError, setFileError] = useState(""), [reading, setReading] = useState(false), [ack, setAck] = useState(false);
  const sequence = useRef(0);
  const [generation, setGeneration] = useState(0);
  const [state, action, pending] = useActionState(migrationAction.bind(null, companyId), {} as MigrationActionState);
  const fields = fieldsFor(spec.kind);
  const csv = useMemo(() => { if (!file) return null; try { return readMigrationCsv(file.text, spec.delimiter, spec.headerRecord); } catch { return null; } }, [file, spec.delimiter, spec.headerRecord]);
  const local = useMemo(() => {
    if (!file || !csv) return null;
    try { return { count: prepareMigration(file.text, spec).rows.length, error: null }; }
    catch (e) { return { count: 0, error: e instanceof MigrationCsvError ? { code: e.code, row: e.row, field: e.field } : { code: "invalid" as const, row: 0, field: "" } }; }
  }, [file, spec, csv]);
  const reviewKey = JSON.stringify({ spec, generation: file?.generation ?? generation, locale });
  const review = state.reviewKey === reviewKey ? state.preview : undefined;
  function change(patch: Partial<MigrationSpec>) { setSpec(s => ({ ...s, ...patch })); setAck(false); }
  async function chooseFile(chosen: File | undefined) {
    const generation = ++sequence.current; setGeneration(generation); setFile(null); setAck(false); setFileError(""); setReading(true);
    try {
      if (!chosen || !chosen.size || chosen.size > MAX_MIGRATION_BYTES) { setFileError(t("fileInvalid")); return; }
      const text = decodeMigrationCsv(new Uint8Array(await chosen.arrayBuffer()));
      if (generation !== sequence.current) return;
      setFile({ text, generation }); setSpec(s => ({ ...s, mapping: {} }));
    } catch { if (generation === sequence.current) setFileError(t("fileInvalid")); }
    finally { if (generation === sequence.current) setReading(false); }
  }
  return <form action={action} onSubmit={e => { if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "preview") setAck(false); }} onReset={e => e.preventDefault()} className="space-y-6">
    <fieldset disabled={pending} className="space-y-5 disabled:opacity-75">
      <legend className="mb-3 text-lg font-semibold">{t("select")}</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm">{t("source")}<select aria-label={t("source")} value={spec.source} onChange={e => change({ source: e.target.value as MigrationSpec["source"] })} className={INPUT}><option value="ONLINE">QuickBooks Online</option><option value="DESKTOP">QuickBooks Desktop</option></select></label>
        <label className="block text-sm">{t("kind")}<select aria-label={t("kind")} value={spec.kind} onChange={e => change({ kind: e.target.value as MigrationKind, mapping: {}, skipExisting: false })} className={INPUT}>{kinds.map(k => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}</select></label>
        <label className="block text-sm">{t("delimiter")}<select aria-label={t("delimiter")} value={spec.delimiter} onChange={e => change({ delimiter: e.target.value as MigrationSpec["delimiter"], mapping: {} })} className={INPUT}><option value=",">{t("comma")}</option><option value=";">{t("semicolon")}</option><option value="\t">{t("tab")}</option></select></label>
        <label className="block text-sm">{t("format")}<select aria-label={t("format")} value={spec.format} onChange={e => change({ format: e.target.value as MigrationSpec["format"] })} className={INPUT}><option value="en">{t("formatEn")}</option><option value="fr-CA">{t("formatFr")}</option></select></label>
        <label className="block text-sm">{t("headerRecord")}<input type="number" min="1" max="20" value={spec.headerRecord} onChange={e => change({ headerRecord: Number(e.target.value), mapping: {} })} className={INPUT}/></label>
        {spec.kind === "BALANCES" ? <label className="block text-sm">{t("cutoverDate")}<input type="date" value={spec.cutoverDate} onChange={e => change({ cutoverDate: e.target.value })} className={INPUT} required/></label> : null}
        {spec.kind === "CUSTOMERS" || spec.kind === "SUPPLIERS" ? <label className="block text-sm">{t("defaultLocale")}<select aria-label={t("defaultLocale")} value={spec.defaultLocale} onChange={e => change({ defaultLocale: e.target.value as MigrationSpec["defaultLocale"] })} className={INPUT}><option value="fr_CA">Français</option><option value="en">English</option></select></label> : null}
      </div>
      <label className="block space-y-2 text-sm"><span>{t("file")}</span><input name="file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={e => void chooseFile(e.target.files?.[0])} className={`block min-h-11 w-full text-sm ${FOCUS}`} required/></label>
      <p className="text-sm text-stone-600 dark:text-stone-400">{t("fileHint")}</p>
      {reading ? <p role="status">{t("reading")}</p> : null}{fileError ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{fileError}</p> : null}
      {file && !csv ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t("csvInvalid")}</p> : null}
      {csv ? <section className="space-y-4" aria-labelledby="migration-mapping"><h2 id="migration-mapping" className="text-lg font-semibold">{t("mapping")}</h2><p className="text-sm">{t("mappingHint", { count: csv.rows.length })}</p><button type="button" className={BUTTON} onClick={() => change({ mapping: suggestMapping(csv.headers, spec.kind) })}>{t("suggest")}</button><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(field => <label key={field} className="block text-sm">{t(`fields.${field}`)}<select aria-label={t(`fields.${field}`)} value={spec.mapping[field] ?? ""} onChange={e => { const mapping = { ...spec.mapping }; if (e.target.value === "") delete mapping[field]; else mapping[field] = Number(e.target.value); change({ mapping }); }} className={INPUT}><option value="">{t("unmapped")}</option>{csv.headers.map((h, i) => <option key={i} value={i}>{i + 1} · {h || t("blankColumn")}</option>)}</select></label>)}</div></section> : null}
      {spec.kind !== "BALANCES" ? <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={spec.skipExisting} onChange={e => change({ skipExisting: e.target.checked })}/>{t("skipExisting")}</label> : <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">{t("balancesHint")}</p>}
      {local?.error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t(`csvErrors.${local.error.code}`, { row: local.error.row, field: FIELDS.includes(local.error.field as MigrationField) ? t(`fields.${local.error.field as MigrationField}`) : local.error.field })}</p> : null}
      <input type="hidden" name="spec" value={JSON.stringify(spec)}/><input type="hidden" name="reviewKey" value={reviewKey}/>
      <button type="submit" name="intent" value="preview" disabled={!local || Boolean(local.error) || reading || pending} className={`${BUTTON} disabled:opacity-50`}>{pending ? t("working") : t("preview")}</button>
    </fieldset>
    {state.messageKey ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errors(state.messageKey as "migration.invalid")}</p> : state.error ? <p role="alert">{errors(`form.${state.error}`)}</p> : null}
    {review ? <section aria-labelledby="migration-review" className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 id="migration-review" className="text-lg font-semibold">{t("review")}</h2><p>{t("summary", { created: review.createdCount, skipped: review.skippedCount })}</p>
      <p className="text-sm text-stone-600 dark:text-stone-400">{t("expiry")}</p>
      {review.totals ? <dl className="grid gap-3 sm:grid-cols-2">{(Object.entries(review.totals) as [keyof NonNullable<typeof review.totals>, string][]).map(([key, value]) => <div key={key} className="rounded-md border border-stone-200 p-3 dark:border-stone-700"><dt className="text-sm">{t(key)}</dt><dd className="font-semibold tabular-nums">{formatMoney(BigInt(value), locale === "en" ? "en" : "fr-CA")}</dd></div>)}</dl> : null}
      {review.ignored.length ? <div className="rounded-md border border-amber-300 p-3 text-sm"><p className="font-medium">{t("ignored")}</p><ul className="mt-2 list-inside list-disc">{review.ignored.map(c => <li key={c.column}>{c.column + 1} · {c.header}</li>)}</ul></div> : null}
      {!review.ready ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t("notReady")}</p> : null}
      <ol className="space-y-3">{review.rows.map(row => <li key={row.source.row} className="min-w-0 rounded-md border border-stone-200 p-3 text-sm dark:border-stone-700">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="min-w-0 break-words font-semibold">{row.source.row} · {row.source.name}</h3><p className="font-medium">{t(`statuses.${row.status}`)}</p></div>
        {row.targetName ? <p className="mt-1 break-words">{t("destination")}: {row.targetName}</p> : null}{row.reason ? <p className="mt-1 text-red-700 dark:text-red-300">{t(`reasons.${row.reason}`)}</p> : null}
        {row.source.kind === "BALANCES" ? <dl className="mt-3 grid gap-2 sm:grid-cols-3">{(["currentCents", "targetCents", "deltaCents"] as const).map(key => <div key={key}><dt>{t(key)}</dt><dd className="font-semibold tabular-nums">{row[key] === undefined ? "—" : formatMoney(BigInt(row[key]!), locale === "en" ? "en" : "fr-CA")}</dd></div>)}</dl> : <details className="mt-3"><summary className={`cursor-pointer ${FOCUS}`}>{t("details")}</summary><dl className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(row.source.data).filter(([key]) => !["kind", "parentId", "incomeAccountId", "expenseAccountId", "defaultTaxCodeId", "notes", "nameEn"].includes(key)).map(([key, value]) => { const field = ({ displayName: "name", addressLine1: "address1", addressLine2: "address2", paymentTermsDays: "terms", locale: "language", unitPrice: "price", nameFr: "name", nameEn: "name", type: "accountType", subtype: "accountSubtype" } as Record<string, MigrationField>)[key] ?? key as MigrationField; return <div key={key} className="min-w-0"><dt className="text-stone-600 dark:text-stone-400">{t(`fields.${field}`)}</dt><dd className="break-words">{value === null || value === "" ? "—" : key === "type" ? enums(`accountType.${value as "ASSET"}`) : key === "subtype" ? enums(`accountSubtype.${value as "BANK"}`) : key === "locale" ? value === "en" ? "English" : "Français" : String(value)}</dd></div>; })}{row.source.kind === "ITEMS" ? ([ ["incomeAccount", row.source.refs.income], ["expenseAccount", row.source.refs.expense], ["taxCode", row.source.refs.tax] ] as const).map(([field, value]) => <div key={field}><dt>{t(`fields.${field}`)}</dt><dd className="break-words">{value || "—"}</dd></div>) : null}</dl></details>}
      </li>)}</ol>
      <input type="hidden" name="token" value={review.token}/><label className="flex min-h-11 items-start gap-3 text-sm"><input name="ack" value="yes" type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="mt-1"/>{t(spec.kind === "BALANCES" ? "confirmBalances" : "confirmLists")}</label>
      <button name="intent" value="confirm" type="submit" disabled={!review.ready || !ack || pending} className={`min-h-11 rounded-md bg-brand-700 px-4 py-2 font-medium text-white disabled:opacity-50 ${FOCUS}`}>{t(spec.kind === "BALANCES" ? "postBalances" : "confirm")}</button>
    </section> : null}
  </form>;
}
