// Which heavy CI jobs a PR needs, by its changed paths (lead decision 2026-11-12: save GitHub Actions minutes).
// Used twice, so the two can never disagree:
// - the `changes` job of pr-checks.yml writes `<job>=true|false` outputs; a heavy job whose output is `false`
//   is skipped by its job-level `if` and its check run concludes `skipped`;
// - the daily check of main (daily.mjs) accepts a `skipped` required job only when this function, given the
//   merged PR's files, says the job was not needed. Anything else that is not `success` is still a violation.
// Fail closed: an unknown path, a truncated file list or an empty one runs every job.

/** Jobs that may be skipped by paths. `requirements`, `secrets`, `traceability` and `changes` always run. */
export const PATH_FILTERED_JOBS = ['web', 'api', 'local-env', 'infra', 'e2e'];

/**
 * Paths that no heavy job reads: documentation, design snapshots, agent rules and skills. Exception: the
 * module catalogue in docs/requirements/arc/ARC-01*.md is read by the api job (check:modules).
 */
export function isDocsOnly(filename) {
  if (/^docs\/requirements\/arc\/ARC-01/.test(filename)) return false;
  if (/^(docs|design|\.claude)\//.test(filename)) return true;
  if (/^[^/]+\.md$/.test(filename)) return true; // AGENTS.md, CLAUDE.md, README.md at the root
  return filename === '.github/pull_request_template.md';
}

/** Changes that run every heavy job: the pipeline itself, this filter, the toolchain and the root manifest. */
const EVERYTHING = /^(\.github\/|tools\/pr-rules\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|\.nvmrc$|\.npmrc$)/;

/**
 * Path prefixes of the narrow jobs; `web` and `api` check the whole workspace and run on any non-docs change. `e2e`
 * (NFR-07@PoC) drives the built web app against the real API and database: it runs when the code of an app or a
 * package changes (and on the pipeline, toolchain and manifest changes above), not for tools or infrastructure alone.
 */
const NARROW = {
  'local-env': /^(infra\/local\/|tools\/local-env\/)/,
  infra: /^(infra\/|tools\/infra-check\/|tools\/observability\/)/,
  e2e: /^(apps\/|packages\/)/,
};

/**
 * @param {{ filename: string, previous_filename?: string }[]} files the PR's changed files (GitHub files API)
 * @param {{ truncated?: boolean }} [opts] truncated: the API returned fewer files than the PR has
 * @returns {Record<string, boolean>} job name → must run
 */
export function jobsToRun(files, { truncated = false } = {}) {
  const all = Object.fromEntries(PATH_FILTERED_JOBS.map((j) => [j, true]));
  if (truncated || !files?.length) return all;
  const names = files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
  const code = names.filter((n) => !isDocsOnly(n));
  if (code.some((n) => EVERYTHING.test(n))) return all;
  return {
    web: code.length > 0,
    api: code.length > 0,
    'local-env': code.some((n) => NARROW['local-env'].test(n)),
    infra: code.some((n) => NARROW.infra.test(n)),
    e2e: code.some((n) => NARROW.e2e.test(n)),
  };
}

/** The `$GITHUB_OUTPUT` lines of the `changes` job. */
export function outputLines(run) {
  return PATH_FILTERED_JOBS.map((j) => `${j}=${run[j] ? 'true' : 'false'}`).join('\n');
}
