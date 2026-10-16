import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
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

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Keyed hash for values that must not be stored in clear (rate-limit keys: IPs, emails). */
export function hmacHex(value: string): string {
  return createHmac("sha256", env().AUTH_SECRET).update(value, "utf8").digest("hex");
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
