import "server-only";
import { z } from "zod";
import { AppError } from "@/platform/errors";
import { withUser } from "@/platform/tenant";
import { getProfile } from "./profile";
import { hit } from "./rate-limit";
import { verifyPassword } from "./crypto";
export async function requireServerAccess(userId: string) {
  const profile = await getProfile(userId);
  if (!profile || (!profile.isInstanceAdmin && !profile.canManageServer)) throw new AppError("forbidden");
  return profile;
}
export async function setServerAccess(userId: string, target: string, enabled: boolean, password: string) {
  if (!(await getProfile(userId))?.isInstanceAdmin) throw new AppError("forbidden");
  if (!z.string().uuid().safeParse(target).success) throw new AppError("members.invalid");
  if (!(await hit("server-access:user", userId, { max: 5, windowSeconds: 900 })).allowed) throw new AppError("members.rateLimited");
  await withUser({ userId }, async tx => {
    const credential = await tx.userCredential.findUnique({ where: { userId }, select: { passwordHash: true } });
    if (!credential || !await verifyPassword(credential.passwordHash, password)) throw new AppError("server.password");
    await tx.$executeRaw`SELECT app_set_server_access(${target}::uuid, ${enabled})`;
  });
}
