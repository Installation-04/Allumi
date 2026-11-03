"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { recordDeposit, voidDeposit } from "@/modules/payments";
import { AppError } from "@/platform/errors";
export async function recordDepositAction(
  companyId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const values = textValues(form, ["accountId", "date", "reference"]);
  return safeAction(async () => {
    const session = await requireSession();
    if (form.get("confirm") !== "yes") throw new AppError("deposits.confirm");
    const result = await recordDeposit(
      { userId: session.userId, companyId },
      {
        ...values,
        paymentIds: form.getAll("paymentId").map(String),
        expectedTotalCents: String(form.get("expectedTotalCents") ?? ""),
      },
    );
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/depots/${result.id}`);
  }, values);
}
export async function voidDepositAction(
  companyId: string,
  id: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const values = textValues(form, ["date", "reason"]);
  return safeAction(async () => {
    const session = await requireSession();
    if (form.get("confirm") !== "yes") throw new AppError("deposits.confirm");
    await voidDeposit({ userId: session.userId, companyId }, id, values);
    revalidatePath(`/c/${companyId}`, "layout");
    return undefined;
  }, values);
}
