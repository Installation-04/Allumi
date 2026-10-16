// Errors raised by the database rules (SQLSTATE AL001…AL010) and by the services.

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

/** Finds an Allumi database rule (AL001…AL010) anywhere in a Prisma or driver error chain. */
export function databaseRuleOf(error: unknown): DatabaseRule | null {
  for (const record of causes(error)) {
    for (const value of [record.originalCode, record.code, record.sqlState]) {
      if (typeof value === "string" && (DATABASE_RULES as readonly string[]).includes(value)) {
        return value as DatabaseRule;
      }
    }
    const message = record.message;
    if (typeof message === "string") {
      const match = /\b(AL0(?:0[1-9]|10))\b/.exec(message);
      if (match) return match[1] as DatabaseRule;
    }
  }
  return null;
}
