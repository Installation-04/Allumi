import type { Credentials, PayPalCredentials, StripeCredentials } from "../domain/credentials";
import type { ProviderId } from "../domain/provider";
import { paypalConnector } from "./paypal";
import { stripeConnector } from "./stripe";
import type { Connector, ConnectorContext } from "./types";

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

export { fetchHttp, type HttpClient, type HttpRequest, type HttpResponse } from "./http";
export type { Connector, ConnectorContext, FetchedWindow } from "./types";
