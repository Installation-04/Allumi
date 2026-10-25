import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can, type Role } from "@/modules/companies";
import { listInvoicePaymentLinks, listPaymentConnections, type PaymentLinkDto } from "@/modules/integrations";
import { formatMoney, type Locale } from "@/modules/ledger";
import { ActionForm, SelectField } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { searchText } from "@/app/_lib/search-params";
import { cancelPaymentLinkAction, collectPaymentsAction, createPaymentLinkAction } from "../integrations/actions";
import { CollectNotice } from "../integrations/collect-notice";

type Query = Record<string, string | string[] | undefined>;
const stamp = (date: Date) => `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;

/**
 * What a posted invoice shows about paying it online: the links made for it, the one that is live, what a payment
 * came to, and (for the owner, who holds the keys) the buttons to make a link, look for a payment and cancel.
 */
export async function OnlinePaymentPanel(props: { companyId: string; role: Role; actor: { userId: string; companyId: string }; invoiceId: string; openCents: bigint; locale: Locale; query: Query }) {
  const { companyId, role, actor, invoiceId, openCents, locale, query } = props;
  const t = await getTranslations("onlinePayments");
  const te = await getTranslations("errors");
  const isOwner = can(role, "integration.manage");
  const links = await listInvoicePaymentLinks(actor, invoiceId);
  const live = links.find((link) => link.status === "PENDING" || link.status === "ACTIVE");
  const connections = isOwner && !live && openCents > 0n ? await listPaymentConnections(actor) : [];
  if (links.length === 0 && !(isOwner && openCents > 0n)) return null;
  const back = `/c/${companyId}/factures/validees/${invoiceId}`;
  const cancel = searchText(query.cancel);
  const reason = (key: string | null) => (key ? (te.has(key as "onlinePayments.rule") ? te(key as "onlinePayments.rule") : te("onlinePayments.rule")) : "");

  const row = (link: PaymentLinkDto) => (
    <li key={link.id} className="space-y-2 rounded border border-stone-300 p-3 break-words dark:border-stone-700">
      <p className="font-medium">
        {t(`statuses.${link.status}`)}{" · "}<span className="tabular-nums">{formatMoney(link.amountCents, locale)}</span>{" · "}{link.connectionLabel}
      </p>
      {link.status === "ACTIVE" && link.url ? (
        <p className="text-sm">
          <span className="block text-stone-600 dark:text-stone-400">{t("addressLabel")}</span>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 items-center rounded break-all underline ${FOCUS}`}>{link.url}</a>
        </p>
      ) : null}
      {link.status === "PENDING" ? <p className="text-sm">{t("pendingHint")}{link.lastError ? ` ${reason(link.lastError)}` : ""}</p> : null}
      {isOwner && link.status === "PENDING" ? (
        <ActionForm action={createPaymentLinkAction.bind(null, companyId, invoiceId)} label={t("resume")} variant="primary">
          <input type="hidden" name="connectionId" value={link.connectionId} />
        </ActionForm>
      ) : null}
      {link.status === "PAID" && link.payment ? (
        <p className="text-sm">
          {t("paidOn", { date: stamp(link.payment.paidAt) })}{" · "}
          <Link href={`/c/${companyId}/encaissements/${link.payment.paymentId}`} className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`}>{link.payment.number}</Link>
          {" · "}{t("fees")} <span className="tabular-nums">{formatMoney(link.payment.feeCents, locale)}</span>{" · "}{t("net")} <span className="tabular-nums">{formatMoney(link.payment.netCents, locale)}</span>
        </p>
      ) : null}
      {link.status === "REVIEW" ? <p role="alert" className="rounded border border-amber-600 p-3 text-sm">{t("reviewHint", { reason: reason(link.reviewReason) })}</p> : null}
      {isOwner && (link.status === "PENDING" || link.status === "ACTIVE" || link.status === "REVIEW") ? (
        <ActionForm action={cancelPaymentLinkAction.bind(null, companyId, invoiceId, link.id)} label={t(link.status === "REVIEW" ? "dismiss" : "cancel")} />
      ) : null}
      {isOwner && link.status === "ACTIVE" ? (
        <div className="space-y-1">
          <ActionForm action={collectPaymentsAction.bind(null, companyId, link.connectionId, back)} label={t("check")} variant="primary" />
          <p className="text-sm text-stone-600 dark:text-stone-400">{t("checkHint")}</p>
        </div>
      ) : null}
    </li>
  );

  return (
    <section className="space-y-3 rounded border border-stone-300 p-4 dark:border-stone-700" aria-labelledby="invoice-online-title">
      <h2 id="invoice-online-title" className="font-semibold">{t("title")}</h2>
      <p className="text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p>
      <CollectNotice query={query} />
      {cancel ? <p role="status" className="rounded border border-brand-700 p-3 text-sm">{t(`cancelResult.${["cancelled", "cancelledOpen", "paid", "review"].includes(cancel) ? cancel : "cancelled"}` as "cancelResult.cancelled")}</p> : null}
      {links.length > 0 ? <ul className="space-y-2">{links.map(row)}</ul> : null}
      {isOwner && !live && openCents > 0n ? (
        connections.length > 0 ? (
          <details className="rounded border border-stone-300 p-4 dark:border-stone-700">
            <summary className="min-h-11 cursor-pointer">{t("create")}</summary>
            <div className="mt-3">
              <ActionForm action={createPaymentLinkAction.bind(null, companyId, invoiceId)} label={t("createSubmit")} variant="primary">
                <p className="text-sm">{t("createHint", { amount: formatMoney(openCents, locale) })}</p>
                <SelectField name="connectionId" label={t("connectionField")} options={connections.map((connection) => ({ value: connection.id, label: connection.sandbox ? `${connection.label} · ${t("test")}` : connection.label }))} />
              </ActionForm>
            </div>
          </details>
        ) : (
          <p className="text-sm">
            {t("noConnection")}{" "}
            <Link href={`/c/${companyId}/integrations`} className={`inline-flex min-h-11 items-center rounded underline ${FOCUS}`}>{t("goIntegrations")}</Link>
          </p>
        )
      ) : null}
    </section>
  );
}
