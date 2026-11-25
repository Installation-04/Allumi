import { Field, SelectField } from "@/app/_components/ui";
import { getTranslations } from "@/platform/i18n/server";
import { todayIso, type Locale } from "@/modules/ledger";
import { kilometers, type MileageTrip } from "@/modules/mileage/client";
export async function TripFields({trip,locale}:{trip?:MileageTrip;locale:Locale}) {
  const t=await getTranslations("mileage");
  return <>
    <Field name="date" type="date" label={t("date")} defaultValue={trip?.date??todayIso()} hint={t("dateHint")}/>
    <Field name="vehicle" label={t("vehicle")} defaultValue={trip?.vehicle} autoComplete="off" hint={t("vehicleHint")}/>
    <SelectField name="usage" label={t("usage")} defaultValue={trip?.usage??"BUSINESS"} options={(['BUSINESS','PERSONAL'] as const).map(value=>({value,label:t(value)}))}/>
    <Field name="origin" label={t("origin")} defaultValue={trip?.origin} autoComplete="off" hint={t("locationHint")}/>
    <Field name="destination" label={t("destination")} defaultValue={trip?.destination} autoComplete="off" hint={t("locationHint")}/>
    <Field name="purpose" label={t("purpose")} defaultValue={trip?.purpose??""} autoComplete="off" required={false} hint={t("purposeHint")}/>
    <Field name="distance" label={t("distance")} defaultValue={trip?kilometers(trip.distanceMeters,locale,false):""} inputMode="decimal" autoComplete="off" hint={t("distanceHint")}/>
  </>;
}
