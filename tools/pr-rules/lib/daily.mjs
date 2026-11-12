// CICD-01 FR 1, FR 3, FR 4 and FR 5 (ADR-0008): the daily check of `main` and of the PRs merged into it.
// Pure: `evaluate(input)` takes what the workflow fetched from the GitHub REST API (or a recorded fixture) and
// returns findings; `render` turns them into the alert issue. No network, no clock (the input carries `now`).
import { classifyPaths, ownerApprovalNeeded } from './paths.mjs';

export const SEVERITY = {
  violation: 'Порушення', // the rule was broken: the owner must look
  stale: 'Перевірити', // the rule holds only for an earlier commit, or needs the owner's eye
  info: 'Довідково', // informational (branch age)
};

export const BRANCH_MAX_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;

// Verdict lines, as the review-pr skill and the security review write them: the line starts with the verdict,
// optionally as a heading or in bold, the value optionally in «» (`## Verdict: Ready`, `**Verdict: «Ready».**`).
const MARKUP = String.raw`^\s*(?:#{1,6}\s*)?[*_]*\s*`;
const VALUE = String.raw`:\s*[*_]*\s*[«"“]?(Ready|Not ready|Changes requested)\b`;
const VERDICT = new RegExp(`${MARKUP}Verdict${VALUE}`, 'gm');
const SECURITY_VERDICT = new RegExp(`${MARKUP}Security verdict${VALUE}`, 'gm');

/** The verdict of a review body (`kind`: 'review' or 'security'), or null; the last verdict line wins. */
export function verdictOf(body, kind) {
  let last = null;
  for (const m of (body ?? '').matchAll(kind === 'security' ? SECURITY_VERDICT : VERDICT)) last = m[1];
  return last;
}

/** The owner's approval comment: a line that is exactly «Схвалюю» or «Approved» (not quoted). */
export const APPROVAL_LINE = /^\s*(?:схвалюю|approved)\s*[.!]?\s*$/imu;
/** The owner's «stop»: a line that is exactly «stop» or «стоп». */
export const STOP_LINE = /^\s*(?:stop|стоп)\s*[.!]?\s*$/imu;

const lines = (text) => (text ?? '').split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join('\n');
const short = (sha) => (sha ?? '').slice(0, 7);
const at = (iso) => Date.parse(iso);

/** Latest verdict of one kind given before the merge: `{ verdict, commit, review }` or null. */
function latestVerdict(reviews, kind, mergedAt) {
  const given = reviews
    .filter((r) => r.submitted_at && at(r.submitted_at) <= at(mergedAt))
    .map((r) => ({ verdict: verdictOf(r.body, kind), commit: r.commit_id, review: r }))
    .filter((v) => v.verdict)
    .sort((a, b) => at(a.review.submitted_at) - at(b.review.submitted_at));
  return given.at(-1) ?? null;
}

function checkReview(pr, kind, findings) {
  const label = kind === 'security' ? 'Security verdict: Ready' : 'Verdict: Ready';
  const rule = kind === 'security' ? 'FR 4' : 'FR 3, FR 5';
  const subject = `PR #${pr.number}`;
  const last = latestVerdict(pr.reviews ?? [], kind, pr.merged_at);
  if (!last) {
    findings.push({ severity: 'violation', rule, subject, message: `злито без рецензії з «${label}»` });
  } else if (last.verdict !== 'Ready') {
    findings.push({
      severity: 'violation',
      rule,
      subject,
      message: `злито, коли останній вердикт був «${last.verdict}» (рецензія ${last.review.id} на ${short(last.commit)})`,
    });
  } else if (last.commit !== pr.head_sha) {
    findings.push({
      severity: 'stale',
      rule,
      subject,
      message: `«${label}» дано на ${short(last.commit)}, а злито ${short(pr.head_sha)}: коміти після рецензії ніхто не рецензував`,
    });
  }
}

function checkCi(pr, findings) {
  const subject = `PR #${pr.number}`;
  if (!pr.requiredJobs?.length) {
    findings.push({ severity: 'violation', rule: 'FR 3', subject, message: 'не вдалося визначити обов’язкові задачі CI' });
    return;
  }
  const runs = (pr.checkRuns ?? []).filter((r) => !r.app || r.app === 'github-actions');
  const bad = [];
  for (const job of pr.requiredJobs) {
    const run = runs.filter((r) => r.name === job).sort((a, b) => b.id - a.id)[0];
    if (!run) bad.push(`${job}: не запускалась`);
    else if (run.status !== 'completed' || run.conclusion !== 'success') bad.push(`${job}: ${run.conclusion ?? run.status}`);
    else if (at(run.completed_at) > at(pr.merged_at)) bad.push(`${job}: завершилась після злиття`);
  }
  if (bad.length) {
    findings.push({
      severity: 'violation',
      rule: 'FR 3',
      subject,
      message: `CI не зелений на останньому коміті ${short(pr.head_sha)} — ${bad.join('; ')}`,
    });
  }
}

function checkOwnerApproval(pr, owner, findings) {
  const need = ownerApprovalNeeded(pr.files ?? []);
  if (!need.required) return;
  const subject = `PR #${pr.number}`;
  const approvals = (pr.comments ?? []).filter(
    (c) => c.user === owner && at(c.created_at) <= at(pr.merged_at) && APPROVAL_LINE.test(lines(c.body)),
  );
  const why = need.reasons.slice(0, 3).join('; ');
  if (approvals.length === 0) {
    findings.push({
      severity: 'violation',
      rule: 'FR 3',
      subject,
      message: `діє на хмару чи production (${why}), але злито без коментаря власника «Схвалюю»`,
    });
  } else if (pr.head_date && approvals.every((c) => at(c.created_at) < at(pr.head_date))) {
    findings.push({
      severity: 'stale',
      rule: 'FR 3',
      subject,
      message: `схвалення власника написано до останнього коміту ${short(pr.head_sha)} (${why})`,
    });
  }
}

function checkStop(pr, owner, findings) {
  const stops = (pr.comments ?? []).filter(
    (c) => c.user === owner && at(c.created_at) <= at(pr.merged_at) && STOP_LINE.test(lines(c.body)),
  );
  if (stops.length) {
    findings.push({
      severity: 'stale',
      rule: 'FR 3',
      subject: `PR #${pr.number}`,
      message: `у PR є коментар «stop» (${stops.at(-1).created_at}): перевірте, що власник відповів до злиття`,
    });
  }
}

/** Is a commit on main the squash-merge commit of a merged PR into main? */
const fromMergedPr = (commit) =>
  (commit.pulls ?? []).some((p) => p.merged_at && p.merge_commit_sha === commit.sha && (p.base_ref ?? 'main') === 'main');

/**
 * @param {object} input the shape `fetchDailyInput` (lib/fetch.mjs) returns
 * @returns {{ findings: Array<{severity: string, rule: string, subject: string, message: string}>, summary: object }}
 */
export function evaluate(input) {
  const findings = [];
  const now = at(input.now);

  // FR 3: every change of main comes from a merged PR; no force-push.
  if (input.activityError) {
    findings.push({
      severity: 'violation',
      rule: 'FR 3',
      subject: 'main',
      message: `не вдалося прочитати журнал змін main: ${input.activityError}`,
    });
  }
  for (const a of input.activities ?? []) {
    if (a.activity_type === 'pr_merge' || a.activity_type === 'merge_queue_merge') continue;
    const what =
      a.activity_type === 'force_push'
        ? 'force-push у main'
        : a.activity_type === 'push'
          ? 'прямий push у main'
          : `${a.activity_type} для main`;
    findings.push({
      severity: 'violation',
      rule: 'FR 3',
      subject: 'main',
      message: `${what}: ${short(a.before)} → ${short(a.after)}, ${a.actor ?? 'невідомо хто'}, ${a.timestamp}`,
    });
  }
  for (const c of input.commits ?? []) {
    if (!fromMergedPr(c)) {
      findings.push({
        severity: 'violation',
        rule: 'FR 3',
        subject: `коміт ${short(c.sha)}`,
        message: `у main без злитого PR: «${(c.title ?? '').slice(0, 80)}» (${c.date})`,
      });
    }
  }

  // FR 3, FR 4, FR 5: merged PRs.
  for (const pr of input.pulls ?? []) {
    checkCi(pr, findings);
    checkReview(pr, 'review', findings);
    const byPaths = classifyPaths((pr.files ?? []).flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)));
    const labelled = (pr.labels ?? []).includes('sensitive');
    if (byPaths.sensitive || labelled) checkReview(pr, 'security', findings);
    checkOwnerApproval(pr, input.owner, findings);
    checkStop(pr, input.owner, findings);
  }

  // FR 1: working branches live at most 3 days (informational).
  for (const b of input.branches ?? []) {
    if (b.name === 'main' || !b.firstCommitDate) continue;
    const days = Math.floor((now - at(b.firstCommitDate)) / DAY);
    if (days > BRANCH_MAX_DAYS) {
      const pr = b.pr ? `PR #${b.pr.number} ${b.pr.merged ? 'злито' : b.pr.state === 'open' ? 'відкритий' : 'закрито'}` : 'без PR';
      findings.push({ severity: 'info', rule: 'FR 1', subject: `гілка ${b.name}`, message: `${days} дн., ${pr}` });
    }
  }

  const count = (s) => findings.filter((f) => f.severity === s).length;
  return {
    findings,
    summary: {
      window: input.window,
      commits: (input.commits ?? []).length,
      pulls: (input.pulls ?? []).map((p) => p.number),
      violation: count('violation'),
      stale: count('stale'),
      info: count('info'),
    },
  };
}

/** Does the result need the owner's attention (the alert issue)? */
export const needsAlert = (result) => result.summary.violation + result.summary.stale > 0;

/** Markdown for the alert issue and the job summary. */
export function render(result, { runUrl } = {}) {
  const { summary, findings } = result;
  const out = [
    `**Вікно:** ${summary.window?.since} … ${summary.window?.until}`,
    '',
    `Комітів у main: ${summary.commits}; злитих PR: ${summary.pulls.length ? summary.pulls.map((n) => `#${n}`).join(', ') : 'немає'}.`,
    `Порушень: ${summary.violation}; перевірити: ${summary.stale}; довідково: ${summary.info}.`,
  ];
  if (runUrl) out.push('', `Запуск перевірки: ${runUrl}`);
  for (const severity of Object.keys(SEVERITY)) {
    const items = findings.filter((f) => f.severity === severity);
    if (!items.length) continue;
    out.push('', `### ${SEVERITY[severity]}`, '');
    for (const f of items) out.push(`- **${f.subject}** (CICD-01 ${f.rule}): ${f.message}`);
  }
  if (!findings.length) out.push('', 'Порушень не знайдено.');
  return `${out.join('\n')}\n`;
}
