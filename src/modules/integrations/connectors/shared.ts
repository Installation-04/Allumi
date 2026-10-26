import { AppError } from "@/platform/errors";
import { MAX_BODY_CHARS, type HttpClient, type HttpRequest } from "./http";

/**
 * Makes a request and returns its JSON. What went wrong becomes a code the person can act on; the service's own
 * message is dropped on purpose (it can quote a key) and nothing about the request is logged.
 */
export async function requestJson(http: HttpClient, url: string, init: HttpRequest): Promise<unknown> {
  let response;
  try {
    response = await http(url, init);
  } catch {
    throw new AppError("integrations.unavailable");
  }
  if (response.status === 401) throw new AppError("integrations.unauthorized");
  if (response.status === 403) throw new AppError("integrations.forbidden");
  if (response.status === 429) throw new AppError("integrations.rateLimited");
  if (response.status >= 500) throw new AppError("integrations.unavailable");
  if (response.status < 200 || response.status >= 300) throw new AppError("integrations.invalidResponse");
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new AppError("integrations.unavailable");
  }
  if (text.length > MAX_BODY_CHARS) throw new AppError("integrations.invalidResponse");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("integrations.invalidResponse");
  }
}
