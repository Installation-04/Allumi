import fc from "fast-check";

// One place decides how hard the properties are tried (docs/Plan-de-tests.md):
//   FC_NUM_RUNS  runs per property (200 by default and in CI, 10000 for the nightly run)
//   FC_SEED      replays a failing run
fc.configureGlobal({
  numRuns: Number(process.env.FC_NUM_RUNS ?? 200),
  seed: process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined,
});
