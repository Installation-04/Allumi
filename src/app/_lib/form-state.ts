export type FormErrorKey =
  | "invalid"
  | "credentials"
  | "rateLimited"
  | "code"
  | "passwordOrCode"
  | "currentPassword"
  | "mismatch"
  | "tooShort"
  | "tooLong"
  | "sameAsEmail"
  | "sameAsCurrent"
  | "alreadySetUp"
  | "setupToken"
  | "setupTokenMissing"
  | "generic";

/**
 * Result of a server action used with useActionState. `error` is a message of the form catalog (errors.form.*);
 * `messageKey` any other message under `errors` (a database rule such as AL003, or errors.ledger.*).
 */
export type FormState = { notice?: "saved"; error?: FormErrorKey; messageKey?: string; values?: Record<string, string>; recoveryCodes?: string[] } | undefined;

export function textValues(formData: FormData, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, String(formData.get(name) ?? "")]));
}
