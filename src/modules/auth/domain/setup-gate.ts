// Whether /setup may run, and with what (no I/O).

/**
 * - `open`: no token configured, and the instance is not exposed (development, tests, local network over HTTP)
 * - `token_required`: SETUP_TOKEN is set; the form must carry it
 * - `token_missing`: a real deployment (production, HTTPS) without SETUP_TOKEN. Anybody who reaches the
 *   address first would become the administrator, so /setup stays closed until the operator sets a token.
 */
export type SetupGate = "open" | "token_required" | "token_missing";

export function setupGate(config: { nodeEnv: string; appUrl: string; token: string | undefined }): SetupGate {
  if (config.token !== undefined) return "token_required";
  return config.nodeEnv === "production" && /^\s*https:\/\//i.test(config.appUrl) ? "token_missing" : "open";
}
