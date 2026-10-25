import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@/platform/env";

// AES-256-GCM with ENCRYPTION_KEY. Layout: version (1) | iv (12) | tag (16) | ciphertext.
//  - version 1: the instance key itself, no associated data (TOTP secrets).
//  - version 2: a subkey derived (HKDF) for one purpose, and associated data that binds the ciphertext to the row it
//    belongs to: a payload copied to another row, another company or another purpose does not decrypt.
const LEGACY_VERSION = 1;
const BOUND_VERSION = 2;

/** What ties a ciphertext to its use: the purpose derives the key, the context is authenticated (not stored). */
export type SecretBinding = { purpose: string; context: string };

export function encryptionKey(): Buffer {
  return Buffer.from(env().ENCRYPTION_KEY, "base64");
}

function subkey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", encryptionKey(), "allumi", `secret:${purpose}`, 32));
}

export function encrypt(plaintext: string, binding?: SecretBinding): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", binding ? subkey(binding.purpose) : encryptionKey(), iv);
  if (binding) cipher.setAAD(Buffer.from(binding.context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const out = Buffer.concat([Buffer.from([binding ? BOUND_VERSION : LEGACY_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
  return new Uint8Array(out);
}

export function decrypt(payload: Uint8Array, binding?: SecretBinding): string {
  const data = Buffer.from(payload);
  const expected = binding ? BOUND_VERSION : LEGACY_VERSION;
  if (data[0] !== expected) throw new Error("Unsupported encryption version");
  const decipher = createDecipheriv("aes-256-gcm", binding ? subkey(binding.purpose) : encryptionKey(), data.subarray(1, 13));
  if (binding) decipher.setAAD(Buffer.from(binding.context, "utf8"));
  decipher.setAuthTag(data.subarray(13, 29));
  return Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString("utf8");
}
