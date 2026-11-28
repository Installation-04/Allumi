import { FOCUS } from "@/app/_components/focus";
import { Field, SelectField } from "@/app/_components/ui";
import { getTranslations } from "@/platform/i18n/server";
import { todayIso, type Locale } from "@/modules/ledger";
import { duration, type TimeEntry } from "@/modules/time/client";
export async function EntryFields({entry,locale,preset}:{entry?:TimeEntry;locale:Locale;preset?:{code:string;name:string}}) {
  const t=await getTranslations("time");
  return <>
    <Field name="date" type="date" label={t("date")} defaultValue={entry?.date??todayIso()} hint={t("dateHint")}/>
    <Field name="projectCode" label={t("registeredProject")} defaultValue={entry?.projectCode??preset?.code??""} required={false} autoComplete="off" hint={t("registeredHint")}/>
    <Field name="project" label={t("project")} required={false} defaultValue={entry?.project??preset?.name} autoComplete="off" hint={t("projectHint")}/>
    {entry?.projectId&&<label className="flex min-h-11 items-start gap-2 py-2"><input type="checkbox" name="unlinkConfirmed" value="yes" className={`mt-1 h-5 w-5 ${FOCUS}`}/><span>{t("unlinkConfirm")}</span></label>}
    <SelectField name="usage" label={t("usage")} defaultValue={entry?.usage??"BILLABLE"} options={(['BILLABLE','NON_BILLABLE'] as const).map(value=>({value,label:t(value)}))}/>
    <Field name="person" label={t("person")} defaultValue={entry?.person} autoComplete="off" hint={t("personHint")}/>
    <Field name="task" label={t("task")} defaultValue={entry?.task} autoComplete="off" hint={t("taskHint")}/>
    <Field name="notes" label={t("notes")} defaultValue={entry?.notes??""} autoComplete="off" required={false} hint={t("notesHint")}/>
    <Field name="duration" label={t("duration")} defaultValue={entry?duration(entry.minutes,locale,false):""} inputMode="text" autoComplete="off" hint={t("durationHint")}/>
  </>;
}
