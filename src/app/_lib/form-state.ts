export type FormErrorKey =
  | "invalid"
  | "credentials"
  | "rateLimited"
  | "code"
  | "passwordOrCode"
  | "mismatch"
  | "tooShort"
  | "tooLong"
  | "sameAsEmail"
  | "alreadySetUp"
  | "setupToken"
  | "setupTokenMissing"
  | "generic";

/**
 * Result of a server action used with useActionState. `error` is a message of the form catalog (errors.form.*);
 * `messageKey` any other message under `errors` (a database rule such as AL003, or errors.ledger.*).
 */
export type FormState = { error?: FormErrorKey; messageKey?: string; /** A confirmation (a message under `notices`). */ notice?: string; values?: Record<string, string>; recoveryCodes?: string[] } | undefined;

export function textValues(formData: FormData, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, String(formData.get(name) ?? "")]));
}

/** The values of several checkboxes that share a name, joined by commas (the form gives them back the same way). */
export function listValues(formData: FormData, name: string): Record<string, string> {
  return { [name]: formData.getAll(name).map(String).join(",") };
}
