import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { env } from "@/platform/env";

// argon2id, OWASP parameters (19 MiB, 2 iterations).
const ARGON2 = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** A hash to compare against when the account does not exist, so timing does not reveal it. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

/** Opaque token for cookies and links: 256 random bits, base64url. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time comparison of two secrets of any length (their digests are compared). */
export function secretsMatch(expected: string, given: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(expected), digest(given));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** HMAC-SHA-256 under a subkey derived (HKDF) for one purpose, so a secret never plays two roles. */
function keyedHash(secret: Buffer, purpose: string, value: string): string {
  const subkey = Buffer.from(hkdfSync("sha256", secret, "allumi", purpose, 32));
  return createHmac("sha256", subkey).update(value, "utf8").digest("hex");
}

/**
 * Rate-limit keys: IP addresses and e-mails are never stored in clear. Keyed with AUTH_SECRET, which
 * can be rotated at any time (the counters simply start over).
 */
export function rateLimitKey(value: string): string {
  return keyedHash(Buffer.from(env().AUTH_SECRET, "utf8"), "rate-limit", value);
}

/**
 * Recovery codes are stored hashed. They follow the life of ENCRYPTION_KEY, like the TOTP secrets
 * they stand in for, so rotating AUTH_SECRET never invalidates them.
 */
export function recoveryCodeHash(code: string): string {
  return keyedHash(encryptionKey(), "recovery-code", code);
}

// AES-256-GCM with ENCRYPTION_KEY. Layout: version (1) | iv (12) | tag (16) | ciphertext.
const ENCRYPTION_VERSION = 1;

function encryptionKey(): Buffer {
  return Buffer.from(env().ENCRYPTION_KEY, "base64");
}

export function encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const out = Buffer.concat([Buffer.from([ENCRYPTION_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
  return new Uint8Array(out);
}

export function decrypt(payload: Uint8Array): string {
  const data = Buffer.from(payload);
  if (data[0] !== ENCRYPTION_VERSION) throw new Error("Unsupported encryption version");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(1, 13));
  decipher.setAuthTag(data.subarray(13, 29));
  return Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString("utf8");
}
