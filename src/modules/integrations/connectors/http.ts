/** The smallest HTTP surface the connectors need, so tests can stand in for the network and nothing else can leak in. */
export type HttpRequest = { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string };
export type HttpResponse = { status: number; text(): Promise<string> };
export type HttpClient = (url: string, init: HttpRequest) => Promise<HttpResponse>;

const TIMEOUT_MS = 15_000;
/** A response larger than this is not a transaction list. */
export const MAX_BODY_CHARS = 20_000_000;

/**
 * The real network. Redirects are an error (a credential must never follow a redirect to another host) and every
 * request has a deadline. The URL is built by the connector from a fixed host, never from user input.
 */
export const fetchHttp: HttpClient = async (url, init) => {
  const response = await fetch(url, { method: init.method ?? "GET", headers: init.headers, body: init.body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: response.status, text: () => response.text() };
};
