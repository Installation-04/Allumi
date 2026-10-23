import { CreditEditor } from "../editor";
export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ facture?: string }> }) {
  const { facture } = await searchParams;
  return <CreditEditor params={params} invoiceId={typeof facture === "string" ? facture : undefined} />;
}
