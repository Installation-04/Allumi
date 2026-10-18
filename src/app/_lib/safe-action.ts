import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppError, databaseRuleOf } from "@/platform/errors";
import { errorFrames } from "@/platform/error-frames";
import { logger } from "@/platform/logger";
import type { FormState } from "./form-state";

/**
 * Runs the body of a form action. An unexpected failure (database down, undecryptable secret...) becomes a
 * translated message in the form instead of a raw error page; redirect() and notFound() still pass through.
 * Only the error class, the database rule and the call frames are logged, never the message: it can carry
 * personal data (Law 25).
 */
export async function safeAction(run: () => Promise<FormState>, values?: Record<string, string>): Promise<FormState> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    // An expected refusal (a role, a locked period, a rule of the database) is explained to the user.
    if (error instanceof AppError) return { messageKey: error.key, values };
    const rule = databaseRuleOf(error);
    if (rule) return { messageKey: rule, values };
    logger.error({ errorName: error instanceof Error ? error.name : typeof error, rule: databaseRuleOf(error), frames: errorFrames(error) }, "form action failed");
    return { error: "generic", values };
  }
}
