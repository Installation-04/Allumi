import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FOCUS } from "@/app/_components/focus";
import { ActionForm, Field } from "@/app/_components/ui";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { can } from "@/modules/companies";
import { formatMoney, getEntry, todayIso } from "@/modules/ledger";
import { accountName, loadCompany } from "../../_lib";
import { reverseEntryAction } from "../actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata() {
  return { title: (await getTranslations("journal"))("title") };
}

export default async function EntryPage({ params }: { params: Promise<{ companyId: string; entryId: string }> }) {
  const { entryId } = await params;
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  if (!UUID.test(entryId)) notFound();
  const entry = await getEntry(actor, entryId);
  if (!entry) notFound();
  const [t, ts, tj, te] = [await getTranslations("entryDetail"), await getTranslations("enums.source"), await getTranslations("journal"), await getTranslations("entry")];
  const base = `/c/${company.id}/journal`;

  // Numbers of the linked entries, for the "reversed by / reverses" sentences.
  const label = async (id: string | null) => (id ? ((await getEntry(actor, id))?.numberLabel ?? "") : "");
  const [reversedBy, reverses] = [await label(entry.reversedByEntryId), await label(entry.reversesEntryId)];
  const canReverse = can(company, "entry.reverse") && (entry.source === "MANUAL" || entry.source === "OPENING_BALANCE" || entry.source === "BANK") && !entry.reversedByEntryId;
  const fromDocument = !["MANUAL", "OPENING_BALANCE", "BANK", "REVERSAL"].includes(entry.source);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title", { number: entry.numberLabel })}</h1>
        <p className="text-sm text-stone-700 dark:text-stone-300">
          {entry.date} · {ts(entry.source)} · {t("createdAt", { date: todayIso(entry.createdAt) })}
        </p>
        {entry.memo ? <p>{entry.memo}</p> : null}
        {reversedBy ? <p className="font-medium">{t("reversedBy", { number: reversedBy })}</p> : null}
        {reverses ? <p className="font-medium">{t("reverses", { number: reverses })}</p> : null}
        {fromDocument ? <p className="text-sm">{t("voidHint")}</p> : null}
        {entry.source === "BANK" ? <p className="text-sm">{t("bankHint")}</p> : null}
      </div>

      <div className="overflow-x-auto">
        <table className={TABLE_CLASS}>
          <caption className="sr-only">{t("title", { number: entry.numberLabel })}</caption>
          <thead>
            <tr>
              <th scope="col" className={TH_CLASS}>{tj("account")}</th>
              <th scope="col" className={TH_CLASS}>{tj("memo")}</th>
              <th scope="col" className={`${TH_CLASS} text-right`}>{te("debit")}</th>
              <th scope="col" className={`${TH_CLASS} text-right`}>{te("credit")}</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((line) => (
              <tr key={line.id}>
                <td className={TD_CLASS}>
                  <span className="font-mono">{line.accountCode}</span> – {accountName({ nameFr: line.accountNameFr, nameEn: line.accountNameEn }, locale)}
                </td>
                <td className={TD_CLASS}>{line.description}</td>
                <td className={`${TD_CLASS} text-right tabular-nums`}>{line.debitCents > 0n ? formatMoney(line.debitCents, locale) : ""}</td>
                <td className={`${TD_CLASS} text-right tabular-nums`}>{line.creditCents > 0n ? formatMoney(line.creditCents, locale) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} className="px-2 py-2 text-left">{t("total")}</th>
              <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatMoney(entry.totalCents, locale)}</td>
              <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatMoney(entry.totalCents, locale)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {canReverse ? (
        <div className="max-w-lg space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <h2 className="text-lg font-semibold">{t("reverse")}</h2>
          <p className="text-sm">{t("reverseHint")}</p>
          <ActionForm action={reverseEntryAction.bind(null, company.id, entry.id)} label={t("reverseSubmit")}>
            <Field name="date" type="date" label={t("reverseDate")} defaultValue={todayIso() >= entry.date ? todayIso() : entry.date} />
            <Field name="memo" label={t("reverseMemo")} required={false} autoComplete="off" />
          </ActionForm>
        </div>
      ) : null}

      <Link href={base} className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>
        {t("back")}
      </Link>
    </section>
  );
}
