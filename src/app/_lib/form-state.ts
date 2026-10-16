export type FormErrorKey =
  | "invalid"
  | "credentials"
  | "rateLimited"
  | "code"
  | "mismatch"
  | "tooShort"
  | "tooLong"
  | "sameAsEmail"
  | "alreadySetUp"
  | "setupToken"
  | "generic";

/** Result of a server action used with useActionState. */
export type FormState = { error?: FormErrorKey; values?: Record<string, string>; recoveryCodes?: string[] } | undefined;

export function textValues(formData: FormData, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, String(formData.get(name) ?? "")]));
}
