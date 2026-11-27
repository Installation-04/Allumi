import { Field, SelectField } from "@/app/_components/ui";
import { getTranslations } from "@/platform/i18n/server";
import { todayIso, type Locale } from "@/modules/ledger";
import { duration, type TimeEntry } from "@/modules/time/client";
export async function EntryFields({entry,locale}:{entry?:TimeEntry;locale:Locale}) {
  const t=await getTranslations("time");
  return <>
    <Field name="date" type="date" label={t("date")} defaultValue={entry?.date??todayIso()} hint={t("dateHint")}/>
    <Field name="project" label={t("project")} defaultValue={entry?.project} autoComplete="off" hint={t("projectHint")}/>
    <SelectField name="usage" label={t("usage")} defaultValue={entry?.usage??"BILLABLE"} options={(['BILLABLE','NON_BILLABLE'] as const).map(value=>({value,label:t(value)}))}/>
    <Field name="person" label={t("person")} defaultValue={entry?.person} autoComplete="off" hint={t("personHint")}/>
    <Field name="task" label={t("task")} defaultValue={entry?.task} autoComplete="off" hint={t("taskHint")}/>
    <Field name="notes" label={t("notes")} defaultValue={entry?.notes??""} autoComplete="off" required={false} hint={t("notesHint")}/>
    <Field name="duration" label={t("duration")} defaultValue={entry?duration(entry.minutes,locale,false):""} inputMode="text" autoComplete="off" hint={t("durationHint")}/>
  </>;
}
