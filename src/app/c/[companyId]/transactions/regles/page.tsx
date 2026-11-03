import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getBankTransaction, listBankRules, listBankAccounts, previewBankRule, RULE_PREVIEW_LIMIT } from "@/modules/banking";
import { listAccounts, formatMoney } from "@/modules/ledger";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { searchText } from "@/app/_lib/search-params";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../../_lib";
import { saveRuleAction, toggleRuleAction } from "./actions";

export async function generateMetadata() { return { title: (await getTranslations("bankRules"))("title") }; }
export default async function RulesPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "bank.read");
  const [query, rules, accounts, banks, t] = await Promise.all([searchParams, listBankRules(actor), listAccounts(actor, { includeInactive: true }), listBankAccounts(actor), getTranslations("bankRules")]);
  const canManage = can(company, "bank.manage");
  const base = `/c/${company.id}/transactions`;
  const editId = searchText(query.edit);
  const selected = rules.find(rule => rule.id === editId);
  if (editId && !selected) notFound();
  const fromId = searchText(query.from);
  const from = !selected && fromId ? await getBankTransaction(actor, fromId) : null;
  if (fromId && (!from || from.status !== "UNMATCHED" || from.currency !== "CAD" || !banks.some(bank => bank.id === from.accountId))) notFound();
  const preview = selected ? await previewBankRule(actor, selected.id) : null;
  const targets = accounts.filter(a => a.isActive && (a.type === "REVENUE" || a.type === "EXPENSE"));
  if (selected && !targets.some(a => a.id === selected.targetAccountId)) {
    const unavailable = accounts.find(a => a.id === selected.targetAccountId);
    if (unavailable) targets.unshift(unavailable);
  }
  const bankOptions = banks.map(a => ({ value: a.id, label: `${a.code} · ${accountName(a, locale)}` }));
  if (selected?.sourceAccount && !bankOptions.some(a => a.value === selected.sourceAccountId)) bankOptions.unshift({ value: selected.sourceAccount.id, label: `${selected.sourceAccount.code} · ${accountName(selected.sourceAccount, locale)}` });
  const link = `inline-flex min-h-11 items-center rounded px-2 text-sm underline ${FOCUS}`;
  const panel = "space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900";
  const moneyInput = (value: bigint | null | undefined) => value === null || value === undefined ? "" : `${value / 100n}${locale === "en" ? "." : ","}${String(value % 100n).padStart(2, "0")}`;
  return <section className="space-y-5">
    <div><Link href={base} className={link}>{t("back")}</Link><h1 className="break-words text-2xl font-semibold">{t("title")}</h1><p className="mt-2 max-w-3xl text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p></div>
    {searchText(query.saved) === "1" ? <p role="status" className="text-brand-700 dark:text-brand-500">{t("saved")}</p> : null}
    <div className={panel}>
      <h2 className="text-lg font-semibold">{t("list", { count: rules.length })}</h2>
      <p className="text-sm">{t("priorityHint")}</p>
      {!rules.length ? <p>{t("empty")}</p> : <ul className="divide-y divide-stone-200 dark:divide-stone-700">{rules.map(rule => <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0"><Link href={`${base}/regles?edit=${rule.id}`} className={`${link} break-words font-medium`}>{rule.name}</Link><p className="break-words text-sm">{t(rule.enabled ? "active" : "paused")} · {rule.priority} · {rule.targetAccount.code} · {accountName(rule.targetAccount, locale)}</p></div>
        {canManage ? <ActionForm action={toggleRuleAction.bind(null, company.id, rule.id, rule.revision, !rule.enabled)} label={t(rule.enabled ? "pause" : "activate")} ariaLabel={t(rule.enabled ? "pauseNamed" : "activateNamed", { name: rule.name })} /> : null}
      </li>)}</ul>}
      {selected && canManage ? <Link className={link} href={`${base}/regles`}>{t("new")}</Link> : null}
    </div>
    {canManage ? <div className={panel}>
      <h2 className="text-lg font-semibold">{t(selected ? "edit" : "new")}</h2>
      <ActionForm key={`${selected ? `${selected.id}:${selected.revision}` : "new"}:${locale}`} action={saveRuleAction.bind(null, company.id, selected ? { id: selected.id, revision: selected.revision } : undefined)} label={t("save")} variant="primary">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="name" label={t("name")} defaultValue={selected?.name ?? (from?.payee || from?.description)?.slice(0,120)} />
          <Field name="priority" label={t("priority")} defaultValue={String(selected?.priority ?? 100)} inputMode="numeric" />
          <SelectField name="enabled" label={t("status")} defaultValue={String(selected?.enabled ?? true)} options={[{ value: "true", label: t("active") }, { value: "false", label: t("paused") }]} />
          <SelectField name="field" label={t("field")} defaultValue={selected?.field ?? (from?.payee ? "PAYEE" : "DESCRIPTION")} options={[{ value: "DESCRIPTION", label: t("description") }, { value: "PAYEE", label: t("payee") }]} />
          <Field name="text" label={t("text")} defaultValue={selected?.text ?? (from?.payee || from?.description)?.slice(0,200)} hint={t("textHint")} />
          <SelectField name="direction" label={t("direction")} defaultValue={selected?.direction ?? (from && from.amountCents > 0n ? "IN" : "OUT")} options={(["ANY", "IN", "OUT"] as const).map(value => ({ value, label: t(value) }))} />
          <SelectField name="sourceAccountId" required={false} label={t("source")} defaultValue={selected ? selected.sourceAccountId ?? "" : from?.accountId ?? ""} options={[{ value: "", label: t("allBanks") }, ...bankOptions]} />
          <SelectField name="targetAccountId" label={t("target")} defaultValue={selected?.targetAccountId ?? ""} options={[{ value: "", label: t("chooseCategory") }, ...targets.map(a => ({ value: a.id, label: `${a.code} · ${accountName(a, locale)}` }))]} />
          <Field name="min" label={t("min")} defaultValue={moneyInput(selected?.minCents)} required={false} inputMode="decimal" />
          <Field name="max" label={t("max")} defaultValue={moneyInput(selected?.maxCents)} required={false} inputMode="decimal" />
        </div>
        <p className="text-sm">{t("taxHint")}</p>
      </ActionForm>
    </div> : null}
    {preview ? <div className={panel}>
      <h2 className="text-lg font-semibold">{t("preview")}</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-medium">{t("field")}</dt><dd>{t(preview.rule.field === "PAYEE" ? "payee" : "description")}</dd></div>
        <div><dt className="font-medium">{t("text")}</dt><dd className="break-words">{preview.rule.text}</dd></div>
        <div><dt className="font-medium">{t("direction")}</dt><dd>{t(preview.rule.direction === "IN" ? "IN" : preview.rule.direction === "OUT" ? "OUT" : "ANY")}</dd></div>
        <div><dt className="font-medium">{t("source")}</dt><dd className="break-words">{preview.rule.sourceAccount ? `${preview.rule.sourceAccount.code} · ${accountName(preview.rule.sourceAccount, locale)}` : t("allBanks")}</dd></div>
        <div><dt className="font-medium">{t("min")}</dt><dd>{preview.rule.minCents === null ? "—" : formatMoney(preview.rule.minCents, locale)}</dd></div>
        <div><dt className="font-medium">{t("max")}</dt><dd>{preview.rule.maxCents === null ? "—" : formatMoney(preview.rule.maxCents, locale)}</dd></div>
      </dl>
      <p className="text-sm">{t("previewHint", { scanned: preview.scanned, count: preview.matches.length, limit: RULE_PREVIEW_LIMIT })}</p>
      {preview.limited ? <p className="text-sm">{t("limited")}</p> : null}
      {!preview.available ? <p role="status">{t("unavailable")}</p> : null}
      {!preview.rule.enabled ? <p>{t("pausedHint")}</p> : null}
      {!preview.matches.length ? <p>{t("noMatches")}</p> : <ul className="divide-y divide-stone-200 dark:divide-stone-700">{preview.matches.map(txn => <li key={txn.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><Link href={`${base}/${txn.id}`} className={`${link} min-w-0 break-words`}>{txn.txnDate.toISOString().slice(0,10)} · {txn.description}</Link><span className="tabular-nums">{formatMoney(txn.amountCents, locale)}</span></li>)}</ul>}
    </div> : null}
  </section>;
}
