import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { resolveSession, type SessionInfo } from "@/modules/auth";
import { isSecureDeployment, sessionCookieName } from "./cookie-name";

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(sessionCookieName())?.value;
}

/** Resolved once per request. */
export const getSession = cache(async (): Promise<SessionInfo | null> => resolveSession(await readSessionToken()));

/** Pages that need a fully signed-in user (second factor done when enabled). */
export async function requireSession(options: { allowPending?: boolean } = {}): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/connexion");
  if (session.mfaPending && !options.allowPending) redirect("/connexion/2fa");
  return session;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isSecureDeployment(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Browsers ignore a `__Host-` cookie that lacks `Secure`, deletions included, so expire it with the
 * same attributes it was set with (`cookies().delete()` would omit `Secure`).
 */
export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(sessionCookieName(), "", { httpOnly: true, secure: isSecureDeployment(), sameSite: "lax", path: "/", maxAge: 0 });
}

/** Caddy sets X-Forwarded-For and replaces any value sent by the client. */
export async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}
