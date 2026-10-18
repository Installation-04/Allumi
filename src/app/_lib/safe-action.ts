import "server-only";
import { unstable_rethrow } from "next/navigation";
import { databaseRuleOf } from "@/platform/errors";
import { logger } from "@/platform/logger";
import type { FormState } from "./form-state";

/**
 * Runs the body of a form action. An unexpected failure (database down, undecryptable secret...) becomes a
 * translated message in the form instead of a raw error page; redirect() and notFound() still pass through.
 * Only the error class, code and stack are logged: messages can carry personal data (Law 25).
 */
export async function safeAction(run: () => Promise<FormState>, values?: Record<string, string>): Promise<FormState> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    const { name, stack } = error instanceof Error ? error : { name: typeof error, stack: undefined };
    logger.error({ errorName: name, rule: databaseRuleOf(error), stack }, "form action failed");
    return { error: "generic", values };
  }
}
