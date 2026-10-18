// What a client component may import from the companies module: pure domain code, no database.
export { can, ACTIONS, type Action, type Role } from "./domain/permissions";
export * from "./domain/profile";
export * from "./domain/registration";
