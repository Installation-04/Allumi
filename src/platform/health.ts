import "server-only";
import { withAnonymous } from "./tenant";

/** Throws when the database does not answer. Goes through the same tenant helper as every other query. */
export async function checkDatabase(): Promise<void> {
  await withAnonymous((tx) => tx.$queryRaw`SELECT 1`);
}
