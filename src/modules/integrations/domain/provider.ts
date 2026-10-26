/** The services whose transactions Allumi can import. Same list as the database enum `integration_provider`. */
export const PROVIDERS = ["STRIPE", "PAYPAL"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/**
 * What a connection asks for, per service: the fields of its credentials (the form is drawn from this, so a new
 * service adds a definition and a connector, not a screen) and whether the person picks the environment or the
 * credentials tell it.
 */
export type ProviderDefinition = {
  id: ProviderId;
  fields: readonly { name: string; secret: boolean }[];
  /** True when the key itself says whether it is a test key (Stripe); false when the person chooses (PayPal). */
  environmentFromCredentials: boolean;
};

export const PROVIDER_DEFINITIONS: Record<ProviderId, ProviderDefinition> = {
  STRIPE: { id: "STRIPE", fields: [{ name: "apiKey", secret: true }], environmentFromCredentials: true },
  PAYPAL: { id: "PAYPAL", fields: [{ name: "clientId", secret: false }, { name: "clientSecret", secret: true }], environmentFromCredentials: false },
};

export function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}
