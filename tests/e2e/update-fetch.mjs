// Loaded only by Playwright's standalone-server process. Production has no test endpoint or fetch switch.
import { readFileSync } from "node:fs";
const releases = readFileSync(new URL("./fixtures/update-releases.json", import.meta.url), "utf8");
const releaseUrl = "https://api.github.com/repos/Installation-04/Allumi/releases?per_page=50";
const fetchNormally = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === releaseUrl) return Promise.resolve(new Response(releases, { status: 200, headers: { "content-type": "application/json" } }));
  return fetchNormally(input, init);
};
