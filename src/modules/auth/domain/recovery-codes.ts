// Recovery codes: 10 codes of 10 characters from an unambiguous alphabet (no 0/O, 1/I/L).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const RECOVERY_CODE_COUNT = 10;
const CODE_LENGTH = 10;

/** `randomBytes` is injected so the domain stays pure and testable. */
export function generateRecoveryCodes(randomBytes: (size: number) => Uint8Array): string[] {
  const codes: string[] = [];
  while (codes.length < RECOVERY_CODE_COUNT) {
    let code = "";
    // Rejection sampling keeps the distribution uniform.
    while (code.length < CODE_LENGTH) {
      for (const byte of randomBytes(CODE_LENGTH * 2)) {
        if (byte < 248 && code.length < CODE_LENGTH) code += ALPHABET[byte % ALPHABET.length];
      }
    }
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(input: string): string {
  const compact = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return compact.length === CODE_LENGTH ? `${compact.slice(0, 5)}-${compact.slice(5)}` : "";
}
