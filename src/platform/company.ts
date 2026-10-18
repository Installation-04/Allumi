import "server-only";
import { toAppError } from "./errors";
import { withCompany, type Tx } from "./tenant";

/** Who is acting, and in which company. The database only honours the company if the user is a member. */
export type Actor = { userId: string; companyId: string };

/**
 * One transaction in the actor's company. A refusal by a database rule (AL001…AL011) comes out as an AppError
 * whose key is the rule code, so callers handle the application's refusals and the database's the same way.
 */
export async function inCompany<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await withCompany(actor, fn);
  } catch (error) {
    throw toAppError(error);
  }
}
