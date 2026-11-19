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

/** The title of the annotation the check step leaves with the window it covered (#503). */
export const WINDOW_ANNOTATION = 'main-check-window';
const WINDOW_MESSAGE = /^since=(\S+) until=(\S+) chain=(yes|no)$/;

/** The line the check step prints: an annotation on its job naming the window it checked (`chain`: see below). */
export const windowAnnotation = ({ since, until, chain }) =>
  `::notice title=${WINDOW_ANNOTATION}::since=${since} until=${until} chain=${chain ? 'yes' : 'no'}`;

/**
 * The window a run's job covered, from its annotation: `{ since, until, chain }`, null for a run made before
 * the annotation existed, undefined when it cannot be told (unreadable, more than one, malformed: such a run
 * counts as not checked, so the window only grows).
 */
async function coveredBy(gh, job) {
  if (job.id === undefined) return null;
  let list;
  try {
    list = await gh.paginate(`/{repo}/check-runs/${job.id}/annotations?per_page=100`, { max: 300 });
  } catch {
    return undefined;
  }
  const own = list.filter((a) => a.title === WINDOW_ANNOTATION);
  if (!own.length) return null;
  const m = own.length === 1 ? WINDOW_MESSAGE.exec(String(own[0].message ?? '').trim()) : null;
  const since = Date.parse(m?.[1]);
  const until = Date.parse(m?.[2]);
  if (!m || !(since < until)) return undefined;
  return { since, until, chain: m[3] === 'yes' };
}

/**
 * Window start: where the checked time ends, minus an hour of overlap, at most WINDOW_MAX_DAYS back;
 * WINDOW_FALLBACK_HOURS when no run checked a window or the Actions API cannot be read.
 *
 * A run checked a window when its check step succeeded. Its job's annotation (WINDOW_ANNOTATION) names that
 * window; `chain=yes` when the window started where the checked time ended (no --since, no gap), so the time
 * is checked up to its `until`. A scheduled run made before the annotation existed covered up to its own start.
 * A manual run (workflow_dispatch, #503) counts only by its annotation: a window with --since adds its time
 * when it starts inside the checked time, so a run over a gap closes it, and one with a narrow --since later
 * than the checked time never moves the start past the unchecked part. A failed or skipped day is thus
 * covered by the next run. When the start is not where the checked time ends (the cap, the fallback after
 * earlier runs, an unreadable run log) the window is marked `gap`: the check reports it, because this run's
 * success moves the next window past the unchecked time. Read-only (`actions: read`, `checks: read`).
 */
export async function windowStart(gh, until) {
  const fallback = (note, gap) => ({ since: new Date(until.getTime() - WINDOW_FALLBACK_HOURS * HOUR), note, ...(gap ? { gap } : {}) });
  const floor = until.getTime() - WINDOW_MAX_DAYS * 24 * HOUR;
  try {
    const list = (event) => `/{repo}/actions/workflows/${DAILY_WORKFLOW}/runs?event=${event}&status=completed&per_page=30`;
    const { workflow_runs: scheduled } = await gh.get(list('schedule'));
    // Manual runs are an addition: when they cannot be listed, the window is only larger.
    const manual = await gh.get(list('workflow_dispatch')).then((d) => d?.workflow_runs ?? [], () => []);
    const seen = new Set();
    const runs = [...(scheduled ?? []).map((r) => ({ ...r, kind: 'schedule' })), ...manual.map((r) => ({ ...r, kind: 'manual' }))]
      .filter((r) => !seen.has(r.id) && seen.add(r.id))
      .map((r) => ({ ...r, started: Date.parse(r.run_started_at ?? r.created_at) }))
      .filter((r) => r.started < until.getTime())
      .sort((x, y) => y.started - x.started);
    let end; // where the chain of checked time ends, and the run that ended it
    let endRun;
    let tooOld = false;
    const spans = [];
    for (const run of runs) {
      if (end !== undefined && run.started < end) break; // older runs cannot move a known end
      if (run.started < floor) {
        tooOld = runs.some((r) => r.kind === 'schedule' && r.started < floor);
        break;
      }
      const { jobs } = await gh.get(`/{repo}/actions/runs/${run.id}/jobs?per_page=100`);
      const job = (jobs ?? []).find((j) => (j.steps ?? []).some((s) => s.name === DAILY_CHECK_STEP && s.conclusion === 'success'));
      if (!job) continue;
      const covered = await coveredBy(gh, job);
      if (covered === undefined) continue;
      const span = covered ?? (run.kind === 'schedule' ? { until: run.started, chain: true } : null);
      if (!span) continue;
      const to = Math.min(span.until, until.getTime());
      if (span.chain) {
        if (end === undefined || to > end) [end, endRun] = [to, run.id];
      } else spans.push({ since: span.since, until: to, id: run.id });
    }
    // Manual windows extend the chain when they start inside the checked time (or before the cap).
    let start = end ?? (spans.some((w) => w.since <= floor) ? floor : undefined);
    for (const w of spans.sort((x, y) => x.since - y.since)) {
      if (start !== undefined && w.since <= start && w.until > start) [start, endRun] = [w.until, w.id];
    }
    if (start === undefined) {
      if (tooOld) return { since: new Date(floor), note: `останній успішний запуск старший за ${WINDOW_MAX_DAYS} дн.`, gap: true };
      return fallback(`успішного запуску не знайдено: ${WINDOW_FALLBACK_HOURS} год`, (scheduled ?? []).length > 0);
    }
    return { since: new Date(Math.max(floor, start - HOUR)), note: `від запуску ${endRun ?? 'до обмеження'}` };
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

const DAY_MS = 24 * HOUR;
/** Calls kept for the alert issue after the window is read (label, list, comment or issue). */
export const RATE_RESERVE = 50;
/** Calls one merged PR and one commit of main take (an upper estimate of `mergedPull` and `pullsOfCommit`). */
const COST = { pull: 14, commit: 3 };

/** [since, until] in day-sized parts, oldest first (#503: a long window is read and paced day by day). */
export function dayChunks(since, until) {
  const out = [];
  for (let t = since.getTime(); t < until.getTime(); t += DAY_MS) {
    out.push({ since: new Date(t), until: new Date(Math.min(t + DAY_MS, until.getTime())) });
  }
  return out;
}

/**
 * Read everything the daily check needs for the window [since, until]. A window longer than a day is read in
 * day-sized parts, oldest first (#503). Before each part after the first, when the token's remaining calls
 * (`x-ratelimit-remaining`) would not cover it and the alert issue, the read stops: the window ends where the
 * last whole part ended (`partial`), and the next run starts there (the check step's annotation, `windowStart`).
 */
export async function fetchDailyInput(gh, { since, until, note, gap }) {
  const repo = await gh.get('/{repo}');
  const main = repo.default_branch;
  const head = (await gh.get(`/{repo}/branches/${encodeURIComponent(main)}`)).commit.sha;
  const chunks = dayChunks(since, until);
  const days = Math.max(1, chunks.length);

  // Branch age (FR 1) first: it does not depend on the window, and a paced read must not starve it.
  const branches = await branchAges(gh, main);

  // Changes of main: the repository activity log (pushes, force-pushes, PR merges) …
  let activities = [];
  let activityError;
  try {
    const all = await gh.paginate(`/{repo}/activity?ref=refs/heads/${encodeURIComponent(main)}&direction=desc&per_page=100`, {
      max: 500 * days,
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

  // … and every commit dated in the window, one day at a time (author dates can be set freely, so both
  // sources are used; the commits a push brought are read with its part below).
  const dated = new Map();
  for (const c of chunks) {
    const list = await gh.paginate(
      `/{repo}/commits?sha=${encodeURIComponent(main)}&since=${c.since.toISOString()}&until=${c.until.toISOString()}&per_page=100`,
      { max: 500 },
    );
    for (const commit of list) if (!dated.has(commit.sha)) dated.set(commit.sha, commit);
  }

  // PRs merged into main in the window (closed PRs sorted by last update; stop once older than the window).
  const merged = [];
  let complete = false;
  for (let page = 1; page <= 5 * days; page++) {
    const batch = await gh.get(
      `/{repo}/pulls?state=closed&base=${encodeURIComponent(main)}&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    for (const p of batch) if (p.merged_at && within(p.merged_at, since, until)) merged.push(p);
    if (batch.length < 100 || Date.parse(batch.at(-1).updated_at) < since.getTime()) {
      complete = true;
      break;
    }
  }
  if (!complete) throw new Error(`more than ${500 * days} closed PRs updated in the window: merged PRs may be missed`);

  // The details, part by part. A part's items: activities, dated commits and merges in [part.since, part.until)
  // (the last part also takes its end).
  const shas = new Map();
  const commits = [];
  const pulls = [];
  let covered = since;
  for (const [i, c] of chunks.entries()) {
    const last = i === chunks.length - 1;
    const inPart = (iso) => {
      const t = Date.parse(iso);
      return t >= c.since.getTime() && (last ? t <= c.until.getTime() : t < c.until.getTime());
    };
    const acts = activities.filter((a) => inPart(a.timestamp));
    const own = [...dated.values()].filter((d) => inPart(d.commit?.committer?.date) && !shas.has(d.sha));
    const prs = merged.filter((p) => inPart(p.merged_at));
    const left = gh.rateRemaining?.();
    const cost = COST.pull * prs.length + COST.commit * (own.length + acts.length) + RATE_RESERVE;
    if (i > 0 && left !== undefined && left < cost) break;
    const found = new Map(own.map((d) => [d.sha, d]));
    for (const a of acts) {
      if (!a.before || !a.after || ZERO.test(a.before) || ZERO.test(a.after)) continue;
      // #503: GitHub answers this with 500 «this diff is temporarily unavailable due to heavy server load» at
      // times, even for one commit; the client retries it.
      const cmp = await gh.get(`/{repo}/compare/${a.before}...${a.after}`, { allow404: true });
      for (const x of cmp?.commits ?? []) if (!shas.has(x.sha) && !found.has(x.sha)) found.set(x.sha, x);
    }
    for (const [sha, x] of found) {
      shas.set(sha, x);
      commits.push({
        sha,
        date: x.commit?.committer?.date,
        title: (x.commit?.message ?? '').split('\n')[0],
        pulls: await pullsOfCommit(gh, sha),
      });
    }
    for (const p of prs) pulls.push(await mergedPull(gh, p));
    covered = c.until;
  }
  const partial = covered.getTime() < until.getTime();
  // Merged-PR list order (newest update first), as before the paced read.
  pulls.sort((x, y) => merged.findIndex((p) => p.number === x.number) - merged.findIndex((p) => p.number === y.number));

  return {
    now: until.toISOString(),
    window: {
      since: since.toISOString(),
      until: covered.toISOString(),
      ...(note ? { note } : {}),
      ...(gap ? { gap } : {}),
      ...(partial ? { partial: true, requested: until.toISOString() } : {}),
    },
    owner: repo.owner.login,
    main: { name: main, head },
    activities: activities.filter((a) => Date.parse(a.timestamp) <= covered.getTime()),
    ...(activityError ? { activityError } : {}),
    commits,
    pulls,
    branches,
  };
}

/** Branch age (FR 1): the date of the oldest commit a branch has that main does not. */
async function branchAges(gh, main) {
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
  return branches;
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
