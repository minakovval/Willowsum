// CICD-01 FR 1, FR 3, FR 4 and FR 5 (ADR-0008): the daily check of `main` and of the PRs merged into it.
// Pure: `evaluate(input)` takes what the workflow fetched from the GitHub REST API (or a recorded fixture) and
// returns findings; `render` turns them into the alert issue. No network, no clock (the input carries `now`).
import { classifyFiles, ownerApprovalNeeded, ownerDecisionFiles, safeName, unionClassification } from './paths.mjs';

export const SEVERITY = {
  violation: 'Порушення', // the rule was broken: the owner must look
  stale: 'Перевірити', // the rule holds only for an earlier commit, or needs the owner's eye
  info: 'Довідково', // informational (branch age)
};

export const BRANCH_MAX_DAYS = 3;
/** The only place the default branch name is written; the fetched input carries the real one (`main.name`). */
export const DEFAULT_MAIN = 'main';
/**
 * From this date (owner, 2026-11-12) «Verdict: Ready» and «Security verdict: Ready» must be given on the
 * commit that is merged: a Ready on an older commit is a violation. PRs merged earlier keep the old reading
 * («to check»), so the history is not rewritten.
 */
export const READY_ON_MERGED_COMMIT_FROM = '2026-11-12T00:00:00Z';
const DAY = 24 * 60 * 60 * 1000;

// Verdict lines, as the review-pr skill and the security review write them: the line starts with the verdict,
// optionally as a heading or in bold, the value optionally in «» (`## Verdict: Ready`, `**Verdict: «Ready».**`).
// The value ends the line (trailing punctuation and closing markup only), or the closing bold/italic markup
// ends it: «Verdict: Ready once B1 is fixed» is no verdict. «Not ready» and «Changes requested» both mean
// not ready.
const MARKUP = String.raw`^\s*(?:#{1,6}\s*)?[*_]*\s*`;
// Only «Ready» has the strict end: a negative value counts with any text after it («Not ready — see B1»), so
// the check never fails open on a negative verdict. A trailing NBSP or «…» counts as space or punctuation.
const VALUE = String.raw`:\s*[*_]*\s*[«"“]?(?:(Not ready|Changes requested)\b|(Ready)[»"”]?[.!…]?(?:[*_]*[.!…]?[ \t\u00a0]*$|[*_]+[.!:;,…]?[ \t\u00a0]))`;
const VERDICT = new RegExp(`${MARKUP}Verdict${VALUE}`, 'gm');
const SECURITY_VERDICT = new RegExp(`${MARKUP}Security verdict${VALUE}`, 'gm');

/**
 * The text a reader sees as the author's own words: without HTML comments, `<pre>`-like HTML blocks, fenced and
 * indented code blocks and quoted lines, so that an example or a quoted «Verdict: Ready» or «Схвалюю» never
 * counts — and without hiding text a reader does see (an unclosed `<!--` in the middle of a line is plain text).
 */
export function prose(text) {
  const out = [];
  let fence = null;
  let html = null; // the end of an open HTML block: a comment, or <pre>/<script>/<style>/<textarea>
  for (const line of (text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) {
      // A closing fence has no info string: «```js» inside a fence is code.
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    if (html) {
      if (html.test(line)) html = null;
      continue;
    }
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      fence = f[1];
      continue;
    }
    const comment = /^ {0,3}<!--/.exec(line);
    if (comment && !line.slice(comment[0].length).includes('-->')) {
      html = /-->/;
      continue;
    }
    const tag = /^ {0,3}<(pre|script|style|textarea)(?=[\s>]|$)/i.exec(line);
    if (tag) {
      if (!new RegExp(`</${tag[1]}>`, 'i').test(line)) html = new RegExp(`</${tag[1]}>`, 'i');
      continue;
    }
    if (/^(?: {4}|\t)/.test(line) || /^\s*>/.test(line)) continue;
    out.push(line);
  }
  // Inline comments, also over several lines of one paragraph (never across a blank line).
  return out.join('\n').replace(/<!--(?:(?!\n[ \t]*\n)[\s\S])*?-->/g, '');
}

/** The verdict of a review body (`kind`: 'review' or 'security'), or null; the last verdict line wins. */
export function verdictOf(body, kind) {
  let last = null;
  for (const m of prose(body).matchAll(kind === 'security' ? SECURITY_VERDICT : VERDICT)) last = m[1] ?? m[2];
  return last;
}

/** The owner's approval comment: a line that is exactly «Схвалюю» or «Approved» (not quoted). */
export const APPROVAL_LINE = /^\s*(?:схвалюю|approved)\s*[.!]?\s*$/imu;
/**
 * The owner's decision from chat recorded in the PR body (owner, 2026-11-12): a line
 * «Рішення власника (YYYY-MM-DD): схвалено …». The second accepted form of the approval.
 */
export const BODY_APPROVAL_LINE = /^\s*(?:\*\*)?Рішення власника\s*\(\d{4}-\d{2}-\d{2}\)\s*:\s*(?:\*\*)?\s*схвалено(?!\p{L})(.*)$/imu;
/**
 * A negation or refusal anywhere after «схвалено» («схвалено не буде», «відхилено», «never», «… not approved»)
 * makes the line no approval.
 */
const NEGATION = /(?:^|[^\p{L}])(?:не|ні|відхилено|not|no|never)(?!\p{L})/iu;

/** Does the body hold the owner's chat decision as an approval line (not quoted, not code, not negated)? */
export function bodyApproval(body) {
  for (const line of prose(body).split('\n')) {
    const m = BODY_APPROVAL_LINE.exec(line);
    if (m && !NEGATION.test(m[1])) return true;
  }
  return false;
}
/** A line that records an owner decision: it starts (as a list item or bold too) with «Рішення власника». */
export const OWNER_DECISION_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*)?Рішення власника(?!\p{L})/imu;

/**
 * Does a PR body record the owner's decision? A «Рішення власника …» line, or text under `## Owner decision`
 * once the template's comment is removed (the heading alone, as in the unfilled template, is not enough).
 */
export function recordsOwnerDecision(body) {
  const text = prose(body);
  if (OWNER_DECISION_LINE.test(text)) return true;
  const m = /^(#{1,6})[ \t]*Owner decision[ \t]*#*[ \t]*$/im.exec(text);
  if (!m) return false;
  const rest = text.slice(m.index + m[0].length);
  // A subheading (deeper level) stays inside the section; a heading of the same or a higher level ends it.
  const next = new RegExp(`^#{1,${m[1].length}}[ \\t]`, 'm').exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim() !== '';
}
/** The owner's «stop»: a line that is exactly «stop» or «стоп». */
export const STOP_LINE = /^\s*(?:stop|стоп)\s*[.!]?\s*$/imu;

const lines = (text) => prose(text);
const short = (sha) => (sha ?? '').slice(0, 7);
const at = (iso) => Date.parse(iso);

/** Latest verdict of one kind given before the merge: `{ verdict, commit, review }` or null. */
function latestVerdict(reviews, kind, mergedAt, owner) {
  const given = reviews
    // Reviews are written from the owner's account (ADR-0008); a review from any other account is not a verdict.
    .filter((r) => !owner || r.user === owner)
    // A dismissed review no longer stands; a pending one was never submitted.
    .filter((r) => r.state !== 'DISMISSED' && r.state !== 'PENDING')
    .filter((r) => r.submitted_at && at(r.submitted_at) <= at(mergedAt))
    .map((r) => ({ verdict: verdictOf(r.body, kind), commit: r.commit_id, review: r }))
    .filter((v) => v.verdict)
    .sort((a, b) => at(a.review.submitted_at) - at(b.review.submitted_at));
  return given.at(-1) ?? null;
}

function checkReview(pr, kind, findings, owner) {
  const label = kind === 'security' ? 'Security verdict: Ready' : 'Verdict: Ready';
  const rule = kind === 'security' ? 'FR 4' : 'FR 3, FR 5';
  const subject = `PR #${pr.number}`;
  const last = latestVerdict(pr.reviews ?? [], kind, pr.merged_at, owner);
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
      severity: at(pr.merged_at) >= at(READY_ON_MERGED_COMMIT_FROM) ? 'violation' : 'stale',
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
    const all = runs.filter((r) => r.name === job);
    // The latest run that completed before the merge decides. Later runs (a re-run after the merge, e.g. on
    // an edit of a merged PR's description) are ignored.
    const run = all
      .filter((r) => r.status === 'completed' && r.completed_at && at(r.completed_at) <= at(pr.merged_at))
      .sort((a, b) => b.id - a.id)[0];
    if (!run) bad.push(`${job}: ${all.length ? 'завершилась після злиття' : 'не запускалась'}`);
    else if (run.conclusion !== 'success') bad.push(`${job}: ${run.conclusion}`);
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
  const need = ownerApprovalNeeded(pr.files ?? [], { truncated: pr.filesTruncated });
  const reasons = [...new Set([...need.reasons, ...(pr.baseMap?.approvalReasons ?? [])])];
  if (!reasons.length) return;
  const subject = `PR #${pr.number}`;
  const approvals = (pr.comments ?? []).filter(
    (c) => c.user === owner && at(c.created_at) <= at(pr.merged_at) && APPROVAL_LINE.test(lines(c.body)),
  );
  // Second form: the owner's decision from chat recorded in the PR body (the body as it is when read).
  if (bodyApproval(pr.body)) return;
  const why = reasons.slice(0, 3).join('; ');
  if (approvals.length === 0) {
    findings.push({
      severity: 'violation',
      rule: 'FR 3',
      subject,
      message: `діє на хмару чи production (${why}), але злито без коментаря власника «Схвалюю» і без рядка «Рішення власника (дата): схвалено» в описі`,
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

function checkOwnerDecision(pr, findings) {
  const changed = ownerDecisionFiles(pr.files ?? []);
  if (!changed.length || recordsOwnerDecision(pr.body)) return;
  findings.push({
    severity: 'stale',
    rule: 'FR 3',
    subject: `PR #${pr.number}`,
    message: `змінює правила чи вимоги (${changed.slice(0, 3).join(', ')}), але в описі немає посилання на рішення власника`,
  });
}

/** Is a commit on main the squash-merge commit of a PR merged into main? (Only squash merges are supported.) */
const fromMergedPr = (commit, mainName) =>
  (commit.pulls ?? []).some((p) => p.merged_at && p.merge_commit_sha === commit.sha && p.base_ref === mainName);

/**
 * @param {object} input the shape `fetchDailyInput` (lib/fetch.mjs) returns
 * @returns {{ findings: Array<{severity: string, rule: string, subject: string, message: string}>, summary: object }}
 */
export function evaluate(input) {
  const findings = [];
  const now = at(input.now);
  const mainName = input.main?.name ?? DEFAULT_MAIN;

  // The window could not start at the last checked run: the time before it may never have been checked.
  if (input.window?.gap) {
    findings.push({
      severity: 'stale',
      rule: 'FR 3',
      subject: 'вікно перевірки',
      message: `${input.window.note ?? 'вікно неповне'}; час до ${input.window.since} міг лишитися неперевіреним — запустіть перевірку вручну з since`,
    });
  }

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
    if (!fromMergedPr(c, mainName)) {
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
    checkReview(pr, 'review', findings, input.owner);
    // A PR that edits the map is judged by the map before it (baseMap) and the current one.
    const byPaths = unionClassification(classifyFiles(pr.files ?? [], { truncated: pr.filesTruncated }), pr.baseMap);
    const labelled = (pr.labels ?? []).includes('sensitive');
    if (byPaths.sensitive || labelled) checkReview(pr, 'security', findings, input.owner);
    checkOwnerApproval(pr, input.owner, findings);
    checkStop(pr, input.owner, findings);
    checkOwnerDecision(pr, findings);
  }

  // FR 1: working branches live at most 3 days (informational).
  for (const b of input.branches ?? []) {
    if (b.name === mainName || !b.firstCommitDate) continue;
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
    `**Вікно:** ${summary.window?.since} … ${summary.window?.until}${summary.window?.note ? ` (${summary.window.note})` : ''}`,
    '',
    `Комітів у main: ${summary.commits}; злитих PR: ${summary.pulls.length ? summary.pulls.map((n) => `#${n}`).join(', ') : 'немає'}.`,
    `Порушень: ${summary.violation}; перевірити: ${summary.stale}; довідково: ${summary.info}.`,
  ];
  if (runUrl) out.push('', `Запуск перевірки: ${runUrl}`);
  for (const severity of Object.keys(SEVERITY)) {
    const items = findings.filter((f) => f.severity === severity);
    if (!items.length) continue;
    out.push('', `### ${SEVERITY[severity]}`, '');
    for (const f of items) out.push(`- **${safeName(f.subject)}** (CICD-01 ${f.rule}): ${safeName(f.message)}`);
  }
  if (!findings.length) out.push('', 'Порушень не знайдено.');
  return `${out.join('\n')}\n`;
}
