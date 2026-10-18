// Errors raised by the database rules (SQLSTATE AL001…AL011) and by the services.

export const DATABASE_RULES = [
  "AL001",
  "AL002",
  "AL003",
  "AL004",
  "AL005",
  "AL006",
  "AL007",
  "AL008",
  "AL009",
  "AL010",
  "AL011",
] as const;
export type DatabaseRule = (typeof DATABASE_RULES)[number];

/** An expected, user-facing failure. `key` is a message key under `errors` in messages/*.json. */
export class AppError extends Error {
  constructor(
    readonly key: string,
    message?: string,
  ) {
    super(message ?? key);
    this.name = "AppError";
  }
}

function* causes(error: unknown): Generator<Record<string, unknown>> {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    const record = current as Record<string, unknown>;
    yield record;
    const meta = record.meta as Record<string, unknown> | undefined;
    if (meta && typeof meta === "object") yield meta;
    current = record.cause ?? (meta?.driverAdapterError as unknown);
  }
}

/** Finds an Allumi database rule (AL001…AL011) anywhere in a Prisma or driver error chain. */
export function databaseRuleOf(error: unknown): DatabaseRule | null {
  for (const record of causes(error)) {
    for (const value of [record.originalCode, record.code, record.sqlState]) {
      if (typeof value === "string" && (DATABASE_RULES as readonly string[]).includes(value)) {
        return value as DatabaseRule;
      }
    }
    const message = record.message;
    if (typeof message === "string") {
      const match = /\b(AL0(?:0[1-9]|1[01]))\b/.exec(message);
      if (match) return match[1] as DatabaseRule;
    }
  }
  return null;
}

/** The Prisma error code (P2002 unique violation, P2003 foreign key...) found in an error chain, if any. */
export function prismaErrorCode(error: unknown): string | null {
  for (const record of causes(error)) {
    if (typeof record.code === "string" && /^P\d{4}$/.test(record.code)) return record.code;
  }
  return null;
}

/** A database rule (AL001…AL011) becomes the AppError whose key is the rule code; anything else is returned unchanged. */
export function toAppError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const rule = databaseRuleOf(error);
  return rule ? new AppError(rule, `database rule ${rule}`) : error;
}
