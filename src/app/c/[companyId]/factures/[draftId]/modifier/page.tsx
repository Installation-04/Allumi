import { DraftEditor } from "../../editor";
export default async function Page({ params }: { params: Promise<{ companyId: string; draftId: string }> }) { return <DraftEditor params={params} id={(await params).draftId} />; }
