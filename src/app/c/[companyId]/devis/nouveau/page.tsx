import { notFound } from "next/navigation";
import { EstimateEditor } from "../editor";
export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ copier?: string | string[] }> }) {
  const search = await searchParams;
  if (Array.isArray(search.copier)) notFound();
  return <EstimateEditor params={params} copyId={search.copier} />;
}
