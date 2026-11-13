/**
 * Time budget for a unit test that runs static analysis over real source trees: ESLint with the root config,
 * or the dependency analyzer (dependency-cruiser), directly or through `checkModules` / the scaffold check.
 *
 * Why these tests need their own budget: the work is CPU-bound and single-threaded (TypeScript parses every
 * file; the first ESLint call also loads the root config with typescript-eslint and the React Compiler
 * plugin). Measured alone on a 4-core agent container (2026-11-13): ESLint config load 0.9 s, the ARC-01
 * analysis of apps/api (370 files) 1.8 s, the scaffold check 1.5 s. Vitest's default per-test budget is
 * 5 s for every test, and `pnpm test` runs the package suites at the same time, each with its own pool of
 * workers, next to other sessions on the same machine (CI for this private repository: 2 vCPU). There the
 * same tests took more than 5 s and failed with «Test timed out in 5000ms» in 5 of 6 full runs.
 *
 * Basis of 60 s: in 10 full parallel runs (2026-11-13, load average 7–14 on 4 cores) the slowest of these
 * tests took 8.4 s (the ARC-01 analysis of apps/api; scaffold 7.8 s, the first ESLint call 5.4 s). 60 s is
 * about 7 times that, for a 2 vCPU runner and a busier machine, and still stops a test that hangs. The guard
 * apps/api/test/static-analysis-budget.test.ts fails when a test file runs this analysis without the budget.
 */
export const STATIC_ANALYSIS_TIMEOUT_MS = 60_000;
