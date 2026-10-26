import { AppError } from "@/platform/errors";

/** What is kept of a failure: a code the person can act on, never the service's text (it can quote a key). */
export const failureCode = (error: unknown): string => (error instanceof AppError && error.key.startsWith("integrations.") ? error.key : "integrations.failed");
