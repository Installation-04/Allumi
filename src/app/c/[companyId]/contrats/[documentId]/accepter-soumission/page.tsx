import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError } from "@/platform/errors";
import { getTranslations } from "@/platform/i18n/server";
import { getSignedEstimateReview } from "@/modules/contracts";
import { ActionForm, Field } from "@/app/_components/ui";
import { ClientDocumentBody } from "@/app/document/body";
import { loadCompany } from "../../../_lib";
import { acceptSignedEstimateAction } from "../../actions";
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ companyId: string; documentId: string }> }) {
  const { company, actor } = await loadCompany(params, "sales.manage"), { documentId } = await params;
  const t = await getTranslations("contracts"), e = await getTranslations("estimates"), self = `/c/${company.id}/contrats/${documentId}/accepter-soumission`;
  let review;
  try { review = await getSignedEstimateReview(actor, documentId); }
  catch (error) {
    if (!(error instanceof AppError && error.key === "contracts.evidenceIntegrity")) throw error;
    const errors = await getTranslations("errors");
    return <section className="space-y-4"><Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/contrats/${documentId}`}>{t("acceptBack")}</Link><h1 className="text-2xl font-semibold">{t("reviewSignedEstimate")}</h1><p role="alert">{errors("contracts.evidenceIntegrity")}</p></section>;
  }
  if (!review) notFound();
  return <section className="min-w-0 max-w-4xl space-y-5 break-words [overflow-wrap:anywhere]">
    <div className="print-controls flex flex-wrap gap-4"><Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/contrats/${documentId}`}>{t("acceptBack")}</Link><a className="inline-flex min-h-11 items-center underline" href={self}>{t("acceptReload")}</a></div>
    <h1 className="print-controls text-2xl font-semibold">{t("reviewSignedEstimate")}</h1><p className="print-controls">{t("acceptReviewIntro")}</p>
    <section aria-label={t("acceptSourceTitle")} className="print-controls space-y-3 rounded border p-4"><h2 className="text-lg font-semibold">{t("acceptSourceTitle")}</h2>
      <Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/devis/${review.source.id}`}>{review.source.number ?? review.source.id}</Link>
      <p>{e(`statuses.${review.source.status === "SENT" && !review.source.eligible ? "EXPIRED" : review.source.status}`)} · {e("validUntil")}: {review.source.validUntil}</p>
    </section>
    <ClientDocumentBody document={review.document}/>
    <section aria-label={t("acceptSignedSubmit")} className="print-controls space-y-3 rounded border p-4"><h2 className="text-lg font-semibold">{t("acceptSignedSubmit")}</h2><p>{t("acceptNoPosting")}</p>
      {review.source.eligible ? <ActionForm action={acceptSignedEstimateAction.bind(null, company.id, documentId, review.source.revision, review.document.hash)} label={t("acceptSignedSubmit")}>
        <Field name="note" label={e("decisionNote")} required={false}/>
        <label className="flex min-h-11 items-start gap-3 py-2"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" name="confirm" value="yes" required/><span>{t("acceptConfirm")}</span></label>
      </ActionForm> : <p role="status">{t("acceptNotEligible")}</p>}
    </section>
  </section>;
}
