import { notFound } from "next/navigation";
import { ItemEditor } from "../editor";
export default async function Page({ params }: { params: Promise<{ companyId: string; itemId: string }> }) {
  const { itemId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) notFound();
  return <ItemEditor params={params} id={itemId} />;
}
