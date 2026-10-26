import "server-only";
import { z } from "zod";
import { AppError, isConflict } from "@/platform/errors";
import { withAnonymous, withUser, type Tx } from "@/platform/tenant";
import { checkPassword } from "../domain/password";
import { hashPassword, sha256Hex } from "./crypto";
import { hit } from "./rate-limit";

const schema = z.object({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/), email: z.string().trim().toLowerCase().email().max(254), displayName: z.string().trim().max(120).default(""), password: z.string().max(256).default(""), locale: z.enum(["fr-CA", "en"]).default("fr-CA") });
/** Existing users must be fully authenticated by the caller, including their second factor. */
export async function acceptInvitation(input: unknown, ip: string, userId?: string): Promise<string> {
  if (!(await hit("invitation:ip", ip, { max: 20, windowSeconds: 900 })).allowed) throw new AppError("members.rateLimited");
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError("members.invalid");
  const data = parsed.data;
  let passwordHash: string | null = null;
  if (!userId) {
    if (!data.displayName || checkPassword(data.password, data.email)) throw new AppError("members.password");
    passwordHash = await hashPassword(data.password);
  }
  const accept = async (tx: Tx) => {
    const rows = await tx.$queryRaw<{ company_id: string | null }[]>`SELECT app_accept_invitation(${sha256Hex(data.token)}, ${data.email}, ${data.displayName}, ${passwordHash}, ${data.locale}::app_locale) AS company_id`;
    if (!rows[0]?.company_id) throw new AppError("members.invitationInvalid");
    return rows[0].company_id;
  };
  try { return await (userId ? withUser({ userId }, accept) : withAnonymous(accept)); }
  catch (error) { if (isConflict(error)) throw new AppError("members.invitationInvalid"); throw error; }
}
