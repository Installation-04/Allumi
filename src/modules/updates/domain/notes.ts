import catalogJson from "../../../../release-notes.json";
import { compareVersions, RELEASE_TAG } from "./releases";

export type ReleaseNoteItem = { text: string; guide?: string };
export type ReleaseNotes = {
  title: string;
  added: ReleaseNoteItem[];
  improved: ReleaseNoteItem[];
  fixed: ReleaseNoteItem[];
  installation: ReleaseNoteItem[];
};
const catalog: Record<string, { "fr-CA": ReleaseNotes; en: ReleaseNotes }> = catalogJson;
const normalize = (version: string) => version.startsWith("v") ? version.slice(1) : version;

/** Only the exact installed version is described as current; never substitute a newer release. */
export function installedReleaseNotes(version: string, locale: string): ReleaseNotes | null {
  const key = normalize(version);
  if (!RELEASE_TAG.test(`v${key}`) || !Object.hasOwn(catalog, key)) return null;
  return catalog[key]?.[locale === "en" ? "en" : "fr-CA"] ?? null;
}

/** Keep the embedded history bounded and exclude future versions, including newer prereleases. */
export function earlierReleaseNotes(version: string, locale: string) {
  const current = normalize(version);
  if (!RELEASE_TAG.test(`v${current}`)) return [];
  return Object.keys(catalog).filter(key => compareVersions(key, current) < 0)
    .sort((a, b) => compareVersions(b, a)).slice(0, 5)
    .map(key => ({ version: key, notes: installedReleaseNotes(key, locale)! }));
}
