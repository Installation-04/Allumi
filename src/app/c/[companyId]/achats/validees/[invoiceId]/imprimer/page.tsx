import { getTranslations } from "@/platform/i18n/server";
import { PurchasePrintPage } from "../../../../_purchase-print";

export async function generateMetadata() { return { title: (await getTranslations("purchasePrint"))("copy") }; }

export default async function Page({ params }: { params: Promise<{ companyId: string; invoiceId: string }> }) {
  const { invoiceId } = await params;
  return <PurchasePrintPage params={params} documentId={invoiceId} kind="BILL" />;
}
