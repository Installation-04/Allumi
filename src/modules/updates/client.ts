/** Public types and pure release helpers; no host filesystem or authorization implementation. */
export type { UpdateStatusDetails } from "./domain/status";
export type { Release } from "./domain/releases";
export { compareVersions, RELEASE_TAG } from "./domain/releases";
