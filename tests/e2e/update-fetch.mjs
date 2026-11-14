// Loaded only by Playwright's standalone-server process. Production has no test endpoint or fetch switch.
import { readFileSync } from "node:fs";
const releases = readFileSync(new URL("./fixtures/update-releases.json", import.meta.url), "utf8");
const releaseUrl = "https://api.github.com/repos/Installation-04/Allumi/releases?per_page=50";
const cra = readFileSync(new URL("../fixtures/official-tax-cra.json", import.meta.url), "utf8");
const rq = readFileSync(new URL("../fixtures/official-tax-rq.html", import.meta.url), "utf8");
const fetchNormally = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === releaseUrl) return Promise.resolve(new Response(releases, { status: 200, headers: { "content-type": "application/json" } }));
  if (url === "https://open.canada.ca/data/api/3/action/datastore_search?resource_id=e8f2d0c6-ca67-43d3-862b-6267603dacf6&limit=100") return Promise.resolve(new Response(cra, {headers:{"content-type":"application/json"}}));
  if (url === "https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/regles-de-base-relatives-a-lapplication-de-la-tpstvh-et-de-la-tvq/historique-des-taux/") return Promise.resolve(new Response(rq, {headers:{"content-type":"text/html"}}));
  return fetchNormally(input, init);
};
