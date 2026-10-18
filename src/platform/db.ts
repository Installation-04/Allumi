import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

export type { Prisma } from "@/generated/prisma/client";
export { AppLocale, MemberRole } from "@/generated/prisma/enums";

const globalForPrisma = globalThis as unknown as { __allumiPrisma?: PrismaClient };

/**
 * The application connects with the restricted `allumi_app` role (APP_DATABASE_URL): row level
 * security, privileges and triggers apply to it. The owner credentials never reach the app.
 */
export function prisma(): PrismaClient {
  if (!globalForPrisma.__allumiPrisma) {
    const adapter = new PrismaPg({ connectionString: env().APP_DATABASE_URL, max: 10 });
    globalForPrisma.__allumiPrisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.__allumiPrisma;
}

export async function closePrisma(): Promise<void> {
  const client = globalForPrisma.__allumiPrisma;
  globalForPrisma.__allumiPrisma = undefined;
  await client?.$disconnect();
}
