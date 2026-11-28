"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "@/platform/i18n/client";
import type { ProjectDto } from "@/modules/projects/client";
import type { FormState } from "@/app/_lib/form-state";
import { Field, FormScopeProvider, StateError, SubmitButton, useScopedAction } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { ProjectCustomerLookup } from "./customer-lookup";
function Customer({ companyId, id, name }: {
    companyId: string;
    id: string;
    name: string;
}) {
    const t = useTranslations('projects'), [selected, setSelected] = useState({ id, displayName: name }), { pending } = useFormStatus();
    return <div className="space-y-3"><input type="hidden" name="customerId" value={selected.id}/><input type="hidden" name="customerName" value={selected.displayName}/><p><span className="font-semibold">{t('customer')}: </span>{selected.id ? selected.displayName || t('customerUnavailable') : t('noCustomer')}</p>{selected.id && <button type="button" disabled={pending} className={`min-h-11 rounded border px-4 ${FOCUS}`} onClick={() => setSelected({ id: '', displayName: '' })}>{t('clearCustomer')}</button>}<ProjectCustomerLookup companyId={companyId} onSelect={setSelected}/></div>;
}
export function ProjectForm({ companyId, project, canContacts, action }: {
    companyId: string;
    project?: ProjectDto;
    canContacts: boolean;
    action: (previous: FormState, form: FormData) => Promise<FormState>;
}) {
    const t = useTranslations('projects'), { state, formAction, scope } = useScopedAction(action);
    return <FormScopeProvider scope={scope}><form action={formAction} className="space-y-5"><StateError state={state}/>{project ? <><input type="hidden" name="code" value={project.code}/><p className="break-words"><span className="font-semibold">{t('code')}: </span>{project.code}</p><p className="text-sm">{t('codeImmutable')}</p></> : <Field name="code" label={t('code')} hint={t('codeHint')} autoComplete="off"/>}<Field name="name" label={t('name')} defaultValue={project?.name} hint={t('nameHint')} autoComplete="off"/><Field name="description" label={t('description')} defaultValue={project?.description ?? ''} required={false} hint={t('descriptionHint')} autoComplete="off"/>{canContacts ? <Customer key={scope.attempt} companyId={companyId} id={scope.values?.customerId ?? project?.customerId ?? ''} name={scope.values?.customerName ?? project?.customerName ?? ''}/> : <p className="text-sm">{t('customerHidden')}</p>}<SubmitButton>{project ? t('save') : t('create')}</SubmitButton></form></FormScopeProvider>;
}
