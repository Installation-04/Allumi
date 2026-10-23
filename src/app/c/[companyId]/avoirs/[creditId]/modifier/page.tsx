import { CreditEditor } from "../../editor";
export default async function Page({ params }: { params: Promise<{ companyId: string; creditId: string }> }) {
  return <CreditEditor params={params} id={(await params).creditId} />;
}
