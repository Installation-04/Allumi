import { ItemEditor } from "../editor";
export default function Page({ params }: { params: Promise<{ companyId: string }> }) { return <ItemEditor params={params} />; }
