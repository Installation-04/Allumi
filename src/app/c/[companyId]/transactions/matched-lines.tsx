import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatMoney, type Locale } from "@/modules/ledger";
import type { LedgerLineDto } from "@/modules/banking";
import { FOCUS } from "@/app/_components/focus";

/** One ledger line as the person recognises it: its entry (a link to the journal), the day, what it says and what it moves. */
export async function LedgerLine({ companyId, line, locale }: { companyId: string; line: LedgerLineDto; locale: Locale }) {
  const t = await getTranslations("transactions");
  const text = line.memo || line.description || "";
  return (
    <span className="break-words">
      <Link href={`/c/${companyId}/journal/${line.entryId}`} className={`inline-flex min-h-11 items-center rounded font-medium underline ${FOCUS}`}>{line.entryLabel}</Link>
      {" · "}{line.entryDate}
      {text ? ` · ${text}` : ""}
      {line.contactName ? ` · ${line.contactName}` : ""}
      {" · "}<span className="tabular-nums">{formatMoney(line.cents, locale)}</span>
      {line.reversed ? ` · ${t("reversedNote")}` : ""}
      {line.reconciled ? ` · ${t("reconciledNote")}` : ""}
    </span>
  );
}
