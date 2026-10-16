// No `server-only` here: the proxy also needs the cookie name, and must not load the environment parser.

/** `__Host-` pins the cookie to this exact host over HTTPS; plain HTTP (dev, tests) cannot use it. */
export function isSecureDeployment(): boolean {
  return (process.env.APP_URL ?? "").startsWith("https://");
}

export function sessionCookieName(): string {
  return isSecureDeployment() ? "__Host-allumi_session" : "allumi_session";
}
