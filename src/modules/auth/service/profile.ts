import "server-only";
import { withUser } from "@/platform/tenant";

export type Profile = { id: string; email: string; displayName: string; locale: "fr-CA" | "en"; isInstanceAdmin: boolean; canManageServer: boolean };

export async function getProfile(userId: string): Promise<Profile | null> {
  const user = await withUser({ userId }, (tx) => tx.user.findUnique({ where: { id: userId } }));
  if (!user || user.disabledAt) return null;
  return { id: user.id, email: user.email, displayName: user.displayName, locale: user.locale === "en" ? "en" : "fr-CA", isInstanceAdmin: user.isInstanceAdmin, canManageServer: user.canManageServer };
}
