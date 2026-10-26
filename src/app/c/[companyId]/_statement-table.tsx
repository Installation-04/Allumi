import { formatMoney, type Locale } from "@/modules/ledger";
import type { StatementSection } from "@/modules/reports";
import { TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { accountName } from "./_lib";

const AMOUNT = "tabular-nums text-right";

/** The accounts of a statement section with its total, as rows of a table: its title, each account, the total. */
export function SectionRows({ title, section, totalLabel, locale, hideEmpty = false }: { title: string; section: StatementSection; totalLabel: string; locale: Locale; hideEmpty?: boolean }) {
  if (hideEmpty && section.lines.length === 0) return null;
  return (
    <tbody>
      <tr><th scope="colgroup" colSpan={2} className={`${TH_CLASS} bg-stone-50 dark:bg-stone-900`}>{title}</th></tr>
      {section.lines.map((line) => (
        <tr key={line.accountId}>
          <td className={TD_CLASS}><span className="font-mono">{line.code}</span> – {accountName(line, locale)}</td>
          <td className={`${TD_CLASS} ${AMOUNT}`}>{formatMoney(line.cents, locale)}</td>
        </tr>
      ))}
      <tr><th scope="row" className={`${TD_CLASS} text-left font-semibold`}>{totalLabel}</th><td className={`${TD_CLASS} ${AMOUNT} font-semibold`}>{formatMoney(section.totalCents, locale)}</td></tr>
    </tbody>
  );
}

/** A single figure of a statement (a subtotal such as the gross profit): a label and an amount on one row. */
export function FigureRow({ label, cents, locale, strong = false }: { label: string; cents: bigint; locale: Locale; strong?: boolean }) {
  return (
    <tbody>
      <tr>
        <th scope="row" className={`${TD_CLASS} text-left ${strong ? "text-base font-bold" : "font-semibold"}`}>{label}</th>
        <td className={`${TD_CLASS} ${AMOUNT} ${strong ? "text-base font-bold" : "font-semibold"}`}>{formatMoney(cents, locale)}</td>
      </tr>
    </tbody>
  );
}
