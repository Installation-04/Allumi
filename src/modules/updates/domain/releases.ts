export const RELEASE_TAG = /^v(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-(alpha|beta|rc)\.(\d{1,6}))?$/;
export function compareVersions(a: string, b: string): number {
  const x = RELEASE_TAG.exec(a.startsWith("v") ? a : `v${a}`);
  const y = RELEASE_TAG.exec(b.startsWith("v") ? b : `v${b}`);
  if (!x || !y) throw new Error("Invalid release version");
  for (const i of [1, 2, 3]) { const delta = Number(x[i]) - Number(y[i]); if (delta) return delta; }
  const ranks: Record<string, number> = { alpha: 0, beta: 1, rc: 2, stable: 3 };
  return (ranks[x[4] ?? "stable"]! - ranks[y[4] ?? "stable"]!) || Number(x[5] ?? 0) - Number(y[5] ?? 0);
}
export type Release = { tag: string; url: string };
export function selectRelease(value: unknown, preview: boolean): Release | null {
  if (!Array.isArray(value)) throw new Error("Invalid release response");
  const tags = value.filter((r) => r && !r.draft && typeof r.tag_name === "string" && RELEASE_TAG.test(r.tag_name) && (preview || (!r.prerelease && !r.tag_name.includes("-")))).map((r) => String(r.tag_name));
  tags.sort((a, b) => compareVersions(b, a));
  return tags[0] ? { tag: tags[0], url: `https://github.com/Installation-04/Allumi/releases/tag/${tags[0]}` } : null;
}
