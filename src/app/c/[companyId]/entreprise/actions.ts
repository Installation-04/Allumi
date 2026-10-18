"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { updateCompanyProfile, type CompanyProfileInput } from "@/modules/companies";

const FIELDS = [
  "name",
  "legalName",
  "neq",
  "businessNumber",
  "gstNumber",
  "qstNumber",
  "addressLine1",
  "addressLine2",
  "city",
  "province",
  "postalCode",
  "email",
  "phone",
  "defaultLocale",
  "taxRounding",
  "taxFilingFrequency",
];

export async function updateCompanyAction(companyId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, FIELDS);
  return safeAction(async () => {
    const session = await requireSession();
    await updateCompanyProfile({ userId: session.userId, companyId }, values as unknown as CompanyProfileInput);
    revalidatePath(`/c/${companyId}`, "layout");
    return { notice: "saved" };
  }, values);
}
