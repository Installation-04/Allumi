// Password policy (NIST SP 800-63B): length matters, composition rules do not.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export type PasswordProblem = "tooShort" | "tooLong" | "sameAsEmail";

export function checkPassword(password: string, email?: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return "tooShort";
  if (length > PASSWORD_MAX_LENGTH) return "tooLong";
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) return "sameAsEmail";
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
