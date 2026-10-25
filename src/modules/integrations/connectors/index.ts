import type { Credentials, PayPalCredentials, StripeCredentials } from "../domain/credentials";
import type { ProviderId } from "../domain/provider";
import { paypalConnector } from "./paypal";
import { stripeConnector } from "./stripe";
import { stripePayments } from "./stripe-payments";
import type { Connector, ConnectorContext, PaymentConnector } from "./types";

/**
 * The connector of a service for a set of credentials. A new service adds a case here, its mapper in `domain/` and its
 * credentials in `domain/credentials.ts`; the connection and sync services do not change.
 */
export function createConnector(provider: ProviderId, credentials: Credentials, context: ConnectorContext): Connector {
  switch (provider) {
    case "STRIPE": return stripeConnector(credentials as StripeCredentials, context);
    case "PAYPAL": return paypalConnector(credentials as PayPalCredentials, context);
  }
}

/** The service's payment pages. Only Stripe has them for now (PayPal's need a public address; see docs/Integrations.md). */
export function createPaymentConnector(provider: ProviderId, credentials: Credentials, context: ConnectorContext): PaymentConnector {
  if (provider !== "STRIPE") throw new TypeError(`${provider} has no payment pages`);
  return stripePayments(credentials as StripeCredentials, context);
}

export { fetchHttp, type HttpClient, type HttpRequest, type HttpResponse } from "./http";
export type { Connector, ConnectorContext, FetchedWindow, PaymentConnector, PaymentLinkInput } from "./types";
