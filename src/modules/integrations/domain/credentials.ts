import { z } from "zod";
import type { ProviderId } from "./provider";

/**
 * Stripe: a secret (`sk_`) or restricted (`rk_`) key. A restricted key that can only read balance transactions is
 * the right choice; a publishable key (`pk_`) cannot read anything and is refused here rather than at the first sync.
 */
const stripeSchema = z.object({ apiKey: z.string().trim().regex(/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,250}$/) });
/** PayPal: the client id and secret of a REST app that has the Transaction Search feature. */
const paypalSchema = z.object({
  clientId: z.string().trim().regex(/^[A-Za-z0-9_-]{20,160}$/),
  clientSecret: z.string().trim().regex(/^[A-Za-z0-9_-]{20,250}$/),
});

export type StripeCredentials = z.infer<typeof stripeSchema>;
export type PayPalCredentials = z.infer<typeof paypalSchema>;
export type Credentials = StripeCredentials | PayPalCredentials;

export type ParsedCredentials =
  | { provider: "STRIPE"; credentials: StripeCredentials; hint: string; sandbox: boolean }
  | { provider: "PAYPAL"; credentials: PayPalCredentials; hint: string; sandbox: null };

const last4 = (value: string) => value.slice(-4);

/**
 * Validates what a person typed. The hint is the last four characters of the public part (the Stripe key, the PayPal
 * client id), enough to recognise a key on screen and never enough to use it. Stripe's environment is in the key.
 */
export function parseCredentials(provider: ProviderId, input: unknown): ParsedCredentials | null {
  if (provider === "STRIPE") {
    const parsed = stripeSchema.safeParse(input);
    if (!parsed.success) return null;
    return { provider, credentials: parsed.data, hint: last4(parsed.data.apiKey), sandbox: parsed.data.apiKey.includes("_test_") };
  }
  const parsed = paypalSchema.safeParse(input);
  if (!parsed.success) return null;
  return { provider, credentials: parsed.data, hint: last4(parsed.data.clientId), sandbox: null };
}

/** Credentials read back from storage: the same rules, so a damaged blob is an error and not a request with garbage. */
export function parseStoredCredentials(provider: ProviderId, json: string): Credentials | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  return parseCredentials(provider, value)?.credentials ?? null;
}
