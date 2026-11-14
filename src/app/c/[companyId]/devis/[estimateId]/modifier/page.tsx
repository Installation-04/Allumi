import { EstimateEditor } from "../../editor";
export default async function Page({ params }: { params: Promise<{ companyId: string; estimateId: string }> }) {
  return <EstimateEditor params={params} id={(await params).estimateId} />;
}
