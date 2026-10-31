import { DraftEditor } from "../editor";
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) { return <DraftEditor params={params} />; }
