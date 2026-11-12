// Fetch the input of the daily check (lib/daily.mjs) from the GitHub REST API with read-only calls, and
// write the alert issue (the only write). Everything is shaped into the plain input `evaluate` takes, so a
// run can be saved (`--save-input`) and replayed as a test fixture.
import { ensureLabel } from './github.mjs';
import { REQUIRED_WORKFLOWS, jobNames } from './workflows.mjs';

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
  const [files, reviews, comments, checkRuns, headCommit, mergeCommit] = await Promise.all([
    gh.paginate(`/{repo}/pulls/${n}/files?per_page=100`, { max: 3000 }),
    gh.paginate(`/{repo}/pulls/${n}/reviews?per_page=100`),
    gh.paginate(`/{repo}/issues/${n}/comments?per_page=100`),
    gh.paginate(`/{repo}/commits/${p.head.sha}/check-runs?per_page=100`, { pick: (d) => d.check_runs }),
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
  return {
    number: n,
    title: p.title,
    merged_at: p.merged_at,
    base_ref: p.base.ref,
    head_sha: p.head.sha,
    head_date: headCommit.commit?.committer?.date,
    merge_commit_sha: p.merge_commit_sha,
    labels: p.labels.map((l) => l.name),
    files: files.map((f) => ({
      filename: f.filename,
      previous_filename: f.previous_filename,
      status: f.status,
      patch: f.patch,
      content: f.content ?? undefined,
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
export async function fetchDailyInput(gh, { since, until }) {
  const repo = await gh.get('/{repo}');
  const main = repo.default_branch;
  const head = (await gh.get(`/{repo}/branches/${encodeURIComponent(main)}`)).commit.sha;

  // Changes of main: the repository activity log (pushes, force-pushes, PR merges) …
  let activities = [];
  let activityError;
  try {
    const all = await gh.paginate(`/{repo}/activity?ref=refs/heads/${encodeURIComponent(main)}&per_page=100`, { max: 500 });
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
  for (let page = 1; page <= 5; page++) {
    const batch = await gh.get(
      `/{repo}/pulls?state=closed&base=${encodeURIComponent(main)}&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    for (const p of batch) if (p.merged_at && within(p.merged_at, since, until)) pulls.push(await mergedPull(gh, p));
    if (batch.length < 100 || Date.parse(batch.at(-1).updated_at) < since.getTime()) break;
  }

  // Branch age (FR 1): the date of the oldest commit a branch has that main does not.
  const allPulls = await gh.paginate('/{repo}/pulls?state=all&per_page=100', { max: 500 });
  const branches = [];
  for (const b of await gh.paginate('/{repo}/branches?per_page=100', { max: 300 })) {
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
    window: { since: since.toISOString(), until: until.toISOString() },
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
  const issue = open.find((i) => !i.pull_request);
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
