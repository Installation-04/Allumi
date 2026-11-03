import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { PaymentHistoryFilters } from "@/modules/payments";
import { FOCUS } from "@/app/_components/focus";

export async function PaymentHistoryFilter({
  base,
  filters,
}: {
  base: string;
  filters: PaymentHistoryFilters;
}) {
  const t = await getTranslations("paymentHistory");
  const active = Boolean(
    filters.q || filters.status || filters.from || filters.to,
  );
  const field = `min-h-11 w-full min-w-0 rounded border border-stone-300 bg-white px-3 text-base dark:border-stone-600 dark:bg-stone-950 ${FOCUS}`;
  return (
    <form
      key={JSON.stringify(filters)}
      action={base}
      method="get"
      className="grid min-w-0 gap-3 rounded border border-stone-300 bg-white p-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr] dark:border-stone-700 dark:bg-stone-900"
    >
      <div className="min-w-0 space-y-1">
        <label
          htmlFor="payment-history-search"
          className="block text-sm font-medium"
        >
          {t("search")}
        </label>
        <input
          id="payment-history-search"
          name="q"
          type="search"
          maxLength={120}
          defaultValue={filters.q}
          className={field}
        />
      </div>
      <div className="min-w-0 space-y-1">
        <label
          htmlFor="payment-history-status"
          className="block text-sm font-medium"
        >
          {t("status")}
        </label>
        <select
          id="payment-history-status"
          name="etat"
          defaultValue={filters.status}
          className={field}
        >
          <option value="">{t("all")}</option>
          <option value="POSTED">{t("posted")}</option>
          <option value="VOID">{t("void")}</option>
        </select>
      </div>
      <div className="min-w-0 space-y-1">
        <label
          htmlFor="payment-history-from"
          className="block text-sm font-medium"
        >
          {t("from")}
        </label>
        <input
          id="payment-history-from"
          name="du"
          type="date"
          defaultValue={filters.from}
          className={field}
        />
      </div>
      <div className="min-w-0 space-y-1">
        <label
          htmlFor="payment-history-to"
          className="block text-sm font-medium"
        >
          {t("to")}
        </label>
        <input
          id="payment-history-to"
          name="au"
          type="date"
          defaultValue={filters.to}
          className={field}
        />
      </div>
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-4">
        <button
          type="submit"
          className={`min-h-11 rounded bg-green-700 px-4 text-sm font-semibold text-white hover:bg-green-800 dark:bg-green-600 dark:hover:bg-green-700 ${FOCUS}`}
        >
          {t("apply")}
        </button>
        {active ? (
          <Link
            href={base}
            className={`inline-flex min-h-11 items-center rounded px-3 text-sm underline ${FOCUS}`}
          >
            {t("reset")}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
