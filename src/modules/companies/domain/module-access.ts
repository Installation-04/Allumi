export const MODULES = ["contacts", "catalog", "sales", "accounting", "taxes", "audit"] as const;
export type Module = typeof MODULES[number];
export type Level = "none" | "read" | "write";
export type ModuleAccess = Partial<Record<Module, Level>>;
export type AccessContext = { role: "OWNER" | "USER" | "ACCOUNTANT" | "READ_ONLY"; moduleAccess?: unknown };

export function moduleLevel(context: AccessContext, module: Module): Level {
  if (context.role === "OWNER") return "write";
  const defaults: Level = context.role === "ACCOUNTANT" ? "write" : module === "audit" ? "none" : context.role === "USER" && (module === "contacts" || module === "catalog") ? "write" : "read";
  const overrides = context.moduleAccess;
  const value = overrides && typeof overrides === "object" ? (overrides as ModuleAccess)[module] : undefined;
  const level = value === "none" || value === "read" || value === "write" ? value : defaults;
  return context.role === "READ_ONLY" && level === "write" ? "read" : level;
}
