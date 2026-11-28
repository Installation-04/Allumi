"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProject, updateProject, setProjectArchived, type ProjectInput } from "@/modules/projects";
import { AppError } from "@/platform/errors";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
const names = ['code', 'name', 'description', 'customerId', 'customerName'];
function read(form: FormData): ProjectInput {
    for (const k of ['code', 'name', 'description'])
        if (form.getAll(k).length !== 1 || typeof form.get(k) !== 'string')
            throw new AppError('project.invalid');
    if (form.getAll('customerId').length > 1 || (form.has('customerId') && typeof form.get('customerId') !== 'string'))
        throw new AppError('project.invalid');
    const v = textValues(form, names);
    return { code: v.code ?? '', name: v.name ?? '', description: v.description ?? '', ...(form.has('customerId') ? { customerId: v.customerId || null } : {}) };
}
export async function createAction(companyId: string, _previous: FormState, form: FormData): Promise<FormState> { return safeAction(async () => { const { userId } = await requireSession(), id = await createProject({ companyId, userId }, read(form)); revalidatePath(`/c/${companyId}/projets`); redirect(`/c/${companyId}/projets/${id}`); }, textValues(form, names)); }
export async function updateAction(companyId: string, id: string, revision: number, _previous: FormState, form: FormData): Promise<FormState> { return safeAction(async () => { const { userId } = await requireSession(); await updateProject({ companyId, userId }, id, revision, read(form)); revalidatePath(`/c/${companyId}/projets`); revalidatePath(`/c/${companyId}/projets/${id}`); redirect(`/c/${companyId}/projets/${id}`); }, textValues(form, names)); }
export async function archiveAction(companyId: string, id: string, revision: number, archived: boolean, _previous: FormState, form: FormData): Promise<FormState> { return safeAction(async () => { const { userId } = await requireSession(); if (form.getAll('confirmed').length !== 1 || form.get('confirmed') !== 'yes')
    throw new AppError('project.confirm'); await setProjectArchived({ companyId, userId }, id, revision, archived, true); revalidatePath(`/c/${companyId}/projets`); revalidatePath(`/c/${companyId}/projets/${id}`); revalidatePath(`/c/${companyId}/temps`); redirect(`/c/${companyId}/projets/${id}`); }); }
