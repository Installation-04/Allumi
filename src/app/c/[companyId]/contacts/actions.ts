"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { anonymizeContact, createContact, deleteContact, setContactActive, updateContact, type ContactInput } from "@/modules/contacts";

const CONTACT_FIELDS = [
  "isCustomer",
  "isSupplier",
  "displayName",
  "legalName",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "province",
  "postalCode",
  "country",
  "locale",
  "defaultTaxCodeId",
  "paymentTermsDays",
  "gstNumber",
  "qstNumber",
  "taxExemptionNumber",
  "notes",
] as const;

/** The boxes of the form as the service expects them (checkboxes are "on" or absent; empty boxes are "none"). */
function contactInput(values: Record<string, string>): ContactInput {
  return {
    isCustomer: values.isCustomer === "on",
    isSupplier: values.isSupplier === "on",
    displayName: values.displayName ?? "",
    legalName: values.legalName,
    email: values.email,
    phone: values.phone,
    addressLine1: values.addressLine1,
    addressLine2: values.addressLine2,
    city: values.city,
    province: values.province as ContactInput["province"],
    postalCode: values.postalCode,
    country: values.country,
    locale: values.locale === "en" ? "en" : "fr_CA",
    defaultTaxCodeId: values.defaultTaxCodeId || null,
    paymentTermsDays: values.paymentTermsDays === "" ? 30 : (values.paymentTermsDays as unknown as number),
    gstNumber: values.gstNumber,
    qstNumber: values.qstNumber,
    taxExemptionNumber: values.taxExemptionNumber,
    notes: values.notes,
  };
}

export async function createContactAction(companyId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, [...CONTACT_FIELDS]);
  return safeAction(async () => {
    const session = await requireSession();
    const created = await createContact({ userId: session.userId, companyId }, contactInput(values));
    revalidatePath(`/c/${companyId}/contacts`);
    redirect(`/c/${companyId}/contacts/${created.id}`);
  }, values);
}

export async function updateContactAction(companyId: string, contactId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, [...CONTACT_FIELDS]);
  return safeAction(async () => {
    const session = await requireSession();
    await updateContact({ userId: session.userId, companyId }, contactId, contactInput(values));
    revalidatePath(`/c/${companyId}/contacts`);
    return { notice: "saved" };
  }, values);
}

export async function setContactActiveAction(companyId: string, contactId: string, active: boolean, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await setContactActive({ userId: session.userId, companyId }, contactId, active);
    revalidatePath(`/c/${companyId}/contacts`);
    return undefined;
  });
}

export async function deleteContactAction(companyId: string, contactId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await deleteContact({ userId: session.userId, companyId }, contactId);
    revalidatePath(`/c/${companyId}/contacts`);
    redirect(`/c/${companyId}/contacts`);
  });
}

export async function anonymizeContactAction(companyId: string, contactId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await anonymizeContact({ userId: session.userId, companyId }, contactId);
    revalidatePath(`/c/${companyId}/contacts`);
    return { notice: "anonymized" };
  });
}
