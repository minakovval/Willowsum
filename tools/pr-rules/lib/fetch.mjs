// Fetch the input of the daily check (lib/daily.mjs) from the GitHub REST API with read-only calls, and
// write the alert issue (the only write). Everything is shaped into the plain input `evaluate` takes, so a
// run can be saved (`--save-input`) and replayed as a test fixture.
import { ensureLabel } from './github.mjs';
import { REQUIRED_WORKFLOWS, jobNames } from './workflows.mjs';

/** The map of sensitive paths; a PR that edits it is also judged by the version before it. */
export const PATHS_MODULE = 'tools/pr-rules/lib/paths.mjs';
/** This check's workflow and the step whose success means a window was checked (ADR-0008). */
export const DAILY_WORKFLOW = 'daily-main-check.yml';
export const DAILY_CHECK_STEP = 'Check main and merged PRs';
const HOUR = 3600 * 1000;
export const WINDOW_FALLBACK_HOURS = 25;
export const WINDOW_MAX_DAYS = 7;

export const ALERT_LABEL = 'main-check';
const ZERO = /^0+$/;
const within = (iso, since, until) => {
  const t = Date.parse(iso);
  return t >= since.getTime() && t <= until.getTime();
};

async function fileAt(gh, file, ref) {
  const data = await gh.get(`/{repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`, {
    allow404: true,
  });
  if (!data || Array.isArray(data) || data.encoding !== 'base64') return null;
  return Buffer.from(data.content, 'base64').toString('utf8');
}

/**
 * The map at `ref` (main before the merge, or the PR's base), when the PR edits the map: its classification and
 * approval reasons for these files. The code is main's own (already merged), loaded from a data: URL. Fails
 * closed: a map that cannot be loaded makes the PR sensitive and in need of approval.
 */
export async function baseMapFor(gh, files, ref) {
  const names = files.flatMap((f) => [f.filename, f.previous_filename]);
  if (!names.includes(PATHS_MODULE) || !ref) return undefined;
  try {
    const text = await fileAt(gh, PATHS_MODULE, ref);
    if (!text) return undefined; // the map did not exist yet
    const map = await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
    const paths = files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
    const c = map.classifyPaths(paths);
    return { ...c, approvalReasons: map.ownerApprovalNeeded(files).reasons };
  } catch (e) {
    const why = `the map before this PR could not be loaded (${String(e.message).slice(0, 100)})`;
    return { sensitive: true, categories: ['unlisted'], files: { unlisted: [why] }, approvalReasons: [why] };
  }
}

/**
 * Window start: the start of the last scheduled run whose check step succeeded (minus an hour of overlap),
 * at most WINDOW_MAX_DAYS back; WINDOW_FALLBACK_HOURS when there is none or the Actions API cannot be read.
 * A failed or skipped day is thus covered by the next run. When the start is not the last checked run (the
 * cap, the fallback after earlier runs, an unreadable run log) the window is marked `gap`: the check reports
 * it, because this run's success moves the next window past the unchecked time. Read-only (`actions: read`).
 */
export async function windowStart(gh, until) {
  const fallback = (note, gap) => ({ since: new Date(until.getTime() - WINDOW_FALLBACK_HOURS * HOUR), note, ...(gap ? { gap } : {}) });
  const floor = until.getTime() - WINDOW_MAX_DAYS * 24 * HOUR;
  try {
    const { workflow_runs: runs } = await gh.get(
      `/{repo}/actions/workflows/${DAILY_WORKFLOW}/runs?event=schedule&status=completed&per_page=30`,
    );
    for (const run of runs ?? []) {
      const started = Date.parse(run.run_started_at ?? run.created_at);
      if (!(started < until.getTime())) continue;
      if (started < floor) return { since: new Date(floor), note: `останній успішний запуск старший за ${WINDOW_MAX_DAYS} дн.`, gap: true };
      const { jobs } = await gh.get(`/{repo}/actions/runs/${run.id}/jobs?per_page=100`);
      const checked = (jobs ?? []).some((j) => (j.steps ?? []).some((s) => s.name === DAILY_CHECK_STEP && s.conclusion === 'success'));
      if (checked) return { since: new Date(Math.max(floor, started - HOUR)), note: `від запуску ${run.id}` };
    }
    return fallback(`успішного запуску не знайдено: ${WINDOW_FALLBACK_HOURS} год`, (runs ?? []).length > 0);
  } catch (e) {
    return fallback(`журнал запусків не прочитано (${errorClass(e)}): ${WINDOW_FALLBACK_HOURS} год`, true);
  }
}

/** A short class of an error for the alert (HTTP status, or the error's name). */
export const errorClass = (e) => {
  const m = /HTTP (\d{3})/.exec(String(e?.message));
  return m ? `HTTP ${m[1]}` : (e?.name ?? 'Error');
};

async function pullsOfCommit(gh, sha) {
  const pulls = await gh.get(`/{repo}/commits/${sha}/pulls`);
  return pulls.map((p) => ({
    number: p.number,
    merged_at: p.merged_at,
    merge_commit_sha: p.merge_commit_sha,
    base_ref: p.base?.ref,
  }));
}

async function mergedPull(gh, p) {
  const n = p.number;
  const [full, files, reviews, comments, checkRuns, headCommit, mergeCommit] = await Promise.all([
    gh.get(`/{repo}/pulls/${n}`),
    gh.paginate(`/{repo}/pulls/${n}/files?per_page=100`, { max: 3000 }),
    gh.paginate(`/{repo}/pulls/${n}/reviews?per_page=100`),
    gh.paginate(`/{repo}/issues/${n}/comments?per_page=100`),
    gh.paginate(`/{repo}/commits/${p.head.sha}/check-runs?filter=all&per_page=100`, { pick: (d) => d.check_runs }),
    gh.get(`/{repo}/commits/${p.head.sha}`),
    gh.get(`/{repo}/commits/${p.merge_commit_sha}`),
  ]);
  const parent = mergeCommit.parents?.[0]?.sha;
  // Required jobs: the PR workflows of main just before the merge (a PR cannot exempt itself).
  const requiredJobs = [];
  for (const wf of REQUIRED_WORKFLOWS) {
    const text = parent ? await fileAt(gh, wf, parent) : null;
    if (text) requiredJobs.push(...jobNames(text));
  }
  // A changed workflow is judged by its whole text (the patch shows only the changed lines).
  for (const f of files) {
    if (f.filename.startsWith('.github/workflows/')) {
      f.content = await fileAt(gh, f.filename, f.status === 'removed' ? parent : p.merge_commit_sha);
    }
  }
  const baseMap = await baseMapFor(gh, files, parent);
  return {
    number: n,
    title: p.title,
    body: full.body ?? '',
    ...(baseMap ? { baseMap } : {}),
    merged_at: p.merged_at,
    base_ref: p.base.ref,
    head_sha: p.head.sha,
    head_date: headCommit.commit?.committer?.date,
    merge_commit_sha: p.merge_commit_sha,
    labels: p.labels.map((l) => l.name),
    // The files API stops at 3000 files without a next page: compare with the PR's own count.
    filesTruncated: files.length < (full.changed_files ?? 0),
    files: files.map((f) => ({
      filename: f.filename,
      previous_filename: f.previous_filename,
      status: f.status,
      patch: f.patch,
      content: f.content ?? undefined,
      // GitHub omits the patch of a large diff; such a change cannot be checked and fails closed.
      unreadable: !f.patch && !f.content && f.status !== 'renamed' ? true : undefined,
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      user: r.user?.login,
      state: r.state,
      commit_id: r.commit_id,
      submitted_at: r.submitted_at,
      body: r.body,
    })),
    comments: comments.map((c) => ({ id: c.id, user: c.user?.login, created_at: c.created_at, body: c.body })),
    checkRuns: checkRuns.map((r) => ({
      id: r.id,
      name: r.name,
      app: r.app?.slug,
      status: r.status,
      conclusion: r.conclusion,
      completed_at: r.completed_at,
    })),
    requiredJobs,
  };
}

/** Read everything the daily check needs for the window [since, until]. */
export async function fetchDailyInput(gh, { since, until, note, gap }) {
  const repo = await gh.get('/{repo}');
  const main = repo.default_branch;
  const head = (await gh.get(`/{repo}/branches/${encodeURIComponent(main)}`)).commit.sha;

  // Changes of main: the repository activity log (pushes, force-pushes, PR merges) …
  let activities = [];
  let activityError;
  try {
    const all = await gh.paginate(`/{repo}/activity?ref=refs/heads/${encodeURIComponent(main)}&direction=desc&per_page=100`, {
      max: 500,
      stop: (a) => Date.parse(a.timestamp) < since.getTime(),
    });
    activities = all
      .filter((a) => within(a.timestamp, since, until))
      .map((a) => ({
        timestamp: a.timestamp,
        activity_type: a.activity_type,
        before: a.before,
        after: a.after,
        actor: a.actor?.login,
      }));
  } catch (e) {
    activityError = String(e.message).slice(0, 200);
  }

  // … and the commits they brought, plus every commit dated in the window (author dates can be set freely,
  // so both sources are used).
  const shas = new Map();
  const dated = await gh.paginate(
    `/{repo}/commits?sha=${encodeURIComponent(main)}&since=${since.toISOString()}&until=${until.toISOString()}&per_page=100`,
    { max: 500 },
  );
  for (const c of dated) shas.set(c.sha, c);
  for (const a of activities) {
    if (!a.before || !a.after || ZERO.test(a.before) || ZERO.test(a.after)) continue;
    const cmp = await gh.get(`/{repo}/compare/${a.before}...${a.after}`, { allow404: true });
    for (const c of cmp?.commits ?? []) shas.set(c.sha, c);
  }
  const commits = [];
  for (const [sha, c] of shas) {
    commits.push({
      sha,
      date: c.commit?.committer?.date,
      title: (c.commit?.message ?? '').split('\n')[0],
      pulls: await pullsOfCommit(gh, sha),
    });
  }

  // PRs merged into main in the window (closed PRs sorted by last update; stop once older than the window).
  const pulls = [];
  let complete = false;
  for (let page = 1; page <= 5; page++) {
    const batch = await gh.get(
      `/{repo}/pulls?state=closed&base=${encodeURIComponent(main)}&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    for (const p of batch) if (p.merged_at && within(p.merged_at, since, until)) pulls.push(await mergedPull(gh, p));
    if (batch.length < 100 || Date.parse(batch.at(-1).updated_at) < since.getTime()) {
      complete = true;
      break;
    }
  }
  if (!complete) throw new Error('more than 500 closed PRs updated in the window: merged PRs may be missed');

  // Branch age (FR 1): the date of the oldest commit a branch has that main does not.
  const allPulls = await gh.paginate('/{repo}/pulls?state=all&per_page=100', { max: 500, keepFirst: true });
  const branches = [];
  for (const b of await gh.paginate('/{repo}/branches?per_page=100', { max: 300, keepFirst: true })) {
    if (b.name === main) continue;
    const cmp = await gh.get(`/{repo}/compare/${encodeURIComponent(main)}...${encodeURIComponent(b.name)}`, {
      allow404: true,
    });
    const first = cmp?.commits?.[0] ?? cmp?.base_commit;
    const pr = allPulls.find((p) => p.head?.ref === b.name && p.head?.repo?.full_name === gh.repo);
    branches.push({
      name: b.name,
      firstCommitDate: cmp?.ahead_by ? first?.commit?.committer?.date : cmp?.merge_base_commit?.commit?.committer?.date,
      pr: pr ? { number: pr.number, state: pr.state, merged: Boolean(pr.merged_at) } : null,
    });
  }

  return {
    now: until.toISOString(),
    window: { since: since.toISOString(), until: until.toISOString(), ...(note ? { note } : {}), ...(gap ? { gap } : {}) },
    owner: repo.owner.login,
    main: { name: main, head },
    activities,
    ...(activityError ? { activityError } : {}),
    commits,
    pulls,
    branches,
  };
}

/** Open the alert issue (label `main-check`), or comment on the open one, so the owner is notified. */
export async function upsertAlertIssue(gh, report, window) {
  await ensureLabel(gh, ALERT_LABEL, 'd93f0b', 'CICD-01 FR 3: daily check of main and merged PRs');
  const open = await gh.get(`/{repo}/issues?labels=${ALERT_LABEL}&state=open&per_page=10`);
  // Only an issue this workflow opened: one opened by another account could be muted or locked.
  const issue = open.find((i) => !i.pull_request && i.user?.login === 'github-actions[bot]');
  if (issue) {
    await gh.post(`/{repo}/issues/${issue.number}/comments`, { body: report });
    return issue.html_url;
  }
  const created = await gh.post('/{repo}/issues', {
    title: `Щоденна перевірка main (CICD-01): знайдено порушення, ${window.until.slice(0, 10)}`,
    body: `${report}\nЗакрийте issue, коли розберете; наступні звіти додаються коментарями, поки воно відкрите.\n`,
    labels: [ALERT_LABEL],
  });
  return created.html_url;
}
