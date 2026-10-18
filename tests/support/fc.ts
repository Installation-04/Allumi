import fc from "fast-check";

// One place decides how hard the properties are tried (docs/Plan-de-tests.md):
//   FC_NUM_RUNS  runs per property (200 by default and in CI, 10000 for the nightly run)
//   FC_SEED      replays a failing run
// A malformed value must fail loudly: silently running zero times would keep a nightly job green.
const raw = process.env.FC_NUM_RUNS?.trim();
const runs = raw ? Number(raw) : 200;
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`FC_NUM_RUNS must be a positive integer, got "${process.env.FC_NUM_RUNS}"`);
}
const seed = process.env.FC_SEED?.trim();
if (seed && !Number.isInteger(Number(seed))) throw new Error(`FC_SEED must be an integer, got "${process.env.FC_SEED}"`);

fc.configureGlobal({ numRuns: runs, seed: seed ? Number(seed) : undefined });
