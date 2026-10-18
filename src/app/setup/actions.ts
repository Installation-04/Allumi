"use server";

import { redirect } from "next/navigation";
import { createSession, setupInstance, setupSchema } from "@/modules/auth";
import { initializeLedger } from "@/modules/ledger";
import { logger } from "@/platform/logger";
import { clientIp, setSessionCookie, userAgent } from "@/app/_lib/session";
import { setLocaleCookie } from "@/app/_lib/locale-cookie";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { safeAction } from "@/app/_lib/safe-action";

const VALUE_FIELDS = ["setupToken", "companyName", "displayName", "email", "locale", "fiscalYearStartMonth"];

export async function setupAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, VALUE_FIELDS);
  return safeAction(async () => {
    const parsed = setupSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const mismatch = parsed.error.issues.some((issue) => issue.path[0] === "passwordConfirm");
      return { error: mismatch ? "mismatch" : "invalid", values };
    }

    const result = await setupInstance(parsed.data, await clientIp());
    switch (result.status) {
      case "rate_limited":
        return { error: "rateLimited", values };
      case "invalid_token":
        return { error: "setupToken", values };
      case "token_missing":
        return { error: "setupTokenMissing", values };
      case "already_set_up":
        return { error: "alreadySetUp", values };
      case "weak_password":
        return { error: result.problem, values };
    }

    // The books (chart of accounts, numbering, current fiscal year) are ready at the first sign-in. If that step fails,
    // setup is still complete: the dashboard offers to run it again.
    await initializeLedger({ userId: result.userId, companyId: result.companyId }).catch((error: unknown) =>
      logger.error({ errorName: error instanceof Error ? error.name : typeof error }, "ledger initialization failed after setup"),
    );
    const session = await createSession(result.userId, await userAgent());
    await setSessionCookie(session.token, session.expiresAt);
    await setLocaleCookie(parsed.data.locale);
    redirect(`/c/${result.companyId}`);
  }, values);
}
