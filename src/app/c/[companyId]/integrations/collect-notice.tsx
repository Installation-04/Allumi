import { getTranslations } from "next-intl/server";
import { searchText } from "@/app/_lib/search-params";

type Query = Record<string, string | string[] | undefined>;

const count = (query: Query, name: string) => {
  const value = Number(searchText(query[name]));
  return Number.isInteger(value) && value >= 0 && value < 100_000 ? value : 0;
};

/** What a look at the payment pages found, from the counts in the address (a count, never a payment). Nothing when the page was not just checked. */
export async function CollectNotice({ query }: { query: Query }) {
  if (searchText(query.checked) === undefined) return null;
  const t = await getTranslations("onlinePayments");
  const [paid, review, extra, waiting, failed] = ["paid", "review", "extra", "waiting", "failed"].map((name) => count(query, name));
  return (
    <div role="status" className="space-y-1 rounded border border-brand-700 p-3 text-sm">
      <p>{t("collected", { paid: paid ?? 0 })}</p>
      {review ? <p>{t("collectedReview", { count: review })}</p> : null}
      {extra ? <p>{t("collectedExtra", { count: extra })}</p> : null}
      {waiting ? <p>{t("collectedWaiting", { count: waiting })}</p> : null}
      {failed ? <p>{t("collectedFailed", { count: failed })}</p> : null}
      {searchText(query.more) === "1" ? <p>{t("collectedMore")}</p> : null}
    </div>
  );
}
