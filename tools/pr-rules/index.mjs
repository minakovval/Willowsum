#!/usr/bin/env node
// CICD-01 (ADR-0008) entry point for the workflows. Subcommands:
//   label        — PR job: label a sensitive PR by its file paths (`sensitive`, `sensitive:<category>`).
//   description  — PR job: title starts with an existing requirement ID; the description follows the template.
//   changes      — PR job: which path-filtered CI jobs (web, api, local-env, infra) this PR needs; writes
//                  `<job>=true|false` to $GITHUB_OUTPUT (lib/ci-paths.mjs). Any error runs every job.
//   local        — run by an agent before pushing or PATCHing a PR body (no network, no token): the
//                  `description` check and the `label` decision on the branch's diff against the base.
//                  Flags: --title <PR title> (or --title-file <file>), --body-file <file> (the body to send),
//                  --base <ref> (default origin/main), --root <dir> (default this repository). Exit 1 when the description would fail CI.
//   pre-commit   — the git hook (.githooks/pre-commit): Prettier and ESLint on the staged content of staged files.
//   alerted      — scheduled job, after `daily --outputs` found something: fail the run.
//   daily        — scheduled job: check main and the PRs merged into it; open or update the alert issue.
//                  Flags: --since <ISO> --until <ISO> (default: from the last successful scheduled run, at most
//                  7 days, else 25 hours), --save-input <file>, --input <file> (evaluate a recorded input, no
//                  network), --issue (write the alert issue; without it the run only prints: dry run),
//                  --outputs (write `alert=true|false` to $GITHUB_OUTPUT instead of failing on findings).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobsToRun, outputLines } from './lib/ci-paths.mjs';
import { checkDescription, requirementIds } from './lib/description.mjs';
import { evaluate, needsAlert, render } from './lib/daily.mjs';
import { baseMapFor, errorClass, fetchDailyInput, upsertAlertIssue, windowStart } from './lib/fetch.mjs';
import { client, ensureLabel } from './lib/github.mjs';
import { changedFilesLocal, localClassification } from './lib/local.mjs';
import { preCommit } from './lib/pre-commit.mjs';
import {
  OWNER_DECISION_LABEL,
  classifyFiles,
  labelsFor,
  ownerDecisionFiles,
  safeName,
  unionClassification,
} from './lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? true) : undefined;
};
const summary = (text) => {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
};

function pullRequestEvent() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!event.pull_request) throw new Error('This command runs on pull_request events only.');
  return event.pull_request;
}

async function changedFiles(gh, number) {
  return gh.paginate(`/{repo}/pulls/${number}/files?per_page=100`, { max: 3000 });
}

/** Sensitivity of a PR: its files by the PR's map, and by the base branch's map when the PR edits the map. */
async function classifyPr(gh, pr) {
  const files = await changedFiles(gh, pr.number);
  const own = classifyFiles(files, { truncated: files.length < (pr.changed_files ?? 0) });
  return { files, result: unionClassification(own, await baseMapFor(gh, files, pr.base?.sha)) };
}

async function label() {
  const pr = pullRequestEvent();
  const gh = client();
  const { files, result } = await classifyPr(gh, pr);
  const decision = ownerDecisionFiles(files);
  const labels = [...labelsFor(result), ...(decision.length ? [OWNER_DECISION_LABEL] : [])];
  console.log(result.sensitive ? `Sensitive: ${result.categories.join(', ')}` : 'Not sensitive by file paths.');
  for (const c of result.categories) console.log(`  ${c}: ${safeName(result.files[c].slice(0, 10).join(', '))}`);
  if (decision.length) console.log(`Owner decision needed (rules or requirements): ${safeName(decision.slice(0, 10).join(', '))}`);
  summary(
    result.sensitive
      ? `**Чутливий PR** (${result.categories.join(', ')}): потрібна рецензія безпеки з «Security verdict: Ready» (CICD-01 FR 4).`
      : 'Не чутливий за шляхами файлів.',
  );
  if (!labels.length) return;
  if (pr.head?.repo?.full_name !== gh.repo) {
    // A fork's PR gets a read-only token; the daily check still classifies it by its files.
    console.log(`::notice::PR from a fork: labels not set (${labels.join(', ')}).`);
    return;
  }
  for (const name of labels) {
    if (name === OWNER_DECISION_LABEL) {
      await ensureLabel(gh, name, '5319e7', 'CICD-01 FR 3: changes rules or requirements; the PR body records the owner decision');
    } else {
      await ensureLabel(gh, name, 'b60205', 'CICD-01 FR 4: needs a security review (set by file paths)');
    }
  }
  // Labels are only added, never removed: a later push cannot take the mark away.
  await gh.post(`/{repo}/issues/${pr.number}/labels`, { labels });
}

async function description() {
  const pr = pullRequestEvent();
  const gh = client();
  const { result: sensitive } = await classifyPr(gh, pr);
  const problems = checkDescription({
    title: pr.title,
    body: pr.body,
    ids: requirementIds(path.join(ROOT, 'docs/requirements')),
    sensitive,
  });
  if (!problems.length) {
    console.log('PR title and description follow CICD-01 FR 2.');
    return;
  }
  for (const p of problems) console.log(`::error::${safeName(p)}`);
  summary(['**Опис PR не відповідає CICD-01 п. 2:**', '', ...problems.map((p) => `- ${p}`)].join('\n'));
  process.exitCode = 1;
}

async function changes() {
  const pr = pullRequestEvent();
  let run;
  try {
    const files = await changedFiles(client(), pr.number);
    run = jobsToRun(files, { truncated: files.length < (pr.changed_files ?? 0) });
  } catch (e) {
    console.log(`::warning::Changed files unavailable (${safeName(errorClass(e))}); every job runs.`);
    run = jobsToRun([]);
  }
  const lines = outputLines(run);
  console.log(lines);
  summary(`Задачі CI за шляхами файлів: ${lines.replace(/\n/g, ', ')}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
}

async function daily() {
  let input;
  if (flag('--input')) {
    input = JSON.parse(fs.readFileSync(flag('--input'), 'utf8'));
  } else {
    const date = (v) => {
      const d = new Date(v);
      if (typeof v !== 'string' || Number.isNaN(d.getTime())) throw new Error(`Not an ISO 8601 date: ${v}`);
      return d;
    };
    const until = flag('--until') ? date(flag('--until')) : new Date();
    let since;
    let note;
    let gap;
    if (flag('--since')) since = date(flag('--since'));
    else ({ since, note, gap } = await windowStart(client(), until));
    if (since >= until) throw new Error('--since must be before --until');
    try {
      input = await fetchDailyInput(client(), { since, until, note, gap });
    } catch (e) {
      // Fail closed: a check that could not run is an alert, not a quiet red run.
      const report = `**Вікно:** ${since.toISOString()} … ${until.toISOString()}\n\nПеревірку не вдалося виконати (${safeName(errorClass(e))}): ${safeName(String(e.message).slice(0, 500))}\n`;
      console.log(report);
      summary(report);
      if (flag('--issue')) await upsertAlertIssue(client(), report, { until: until.toISOString() });
      throw e;
    }
  }
  if (flag('--save-input')) fs.writeFileSync(flag('--save-input'), `${JSON.stringify(input, null, 2)}\n`);
  const result = evaluate(input);
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
  const report = render(result, { runUrl });
  console.log(report);
  summary(report);
  if (flag('--issue') && needsAlert(result)) {
    const url = await upsertAlertIssue(client(), report, input.window);
    console.log(`Alert issue: ${url}`);
  }
  if (flag('--outputs') && process.env.GITHUB_OUTPUT) {
    // The workflow fails in a later step, so that this step's success means «the window was checked».
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `alert=${needsAlert(result)}\n`);
  } else if (needsAlert(result)) {
    process.exitCode = 1;
  }
}

/** Local: the description check and the label decision before a push or a body PATCH (no network). */
async function local() {
  const titleFile = flag('--title-file');
  const title = typeof titleFile === 'string' ? fs.readFileSync(titleFile, 'utf8').trim() : flag('--title');
  const bodyFile = flag('--body-file');
  if (typeof title !== 'string' || typeof bodyFile !== 'string') {
    console.error('Usage: node tools/pr-rules/index.mjs local --title "<ID>: <what>" --body-file <file> [--base origin/main]');
    process.exitCode = 2;
    return;
  }
  const base = typeof flag('--base') === 'string' ? flag('--base') : 'origin/main';
  const root = typeof flag('--root') === 'string' ? path.resolve(flag('--root')) : ROOT;
  const body = fs.readFileSync(bodyFile, 'utf8');
  const files = changedFilesLocal(root, base);
  const { sensitive, ownerDecision, approval } = await localClassification(root, base, files);
  console.log(`${files.length} files changed against ${safeName(base)}.`);
  const labels = [...labelsFor(sensitive), ...(ownerDecision.length ? [OWNER_DECISION_LABEL] : [])];
  console.log(`Labels CI will set: ${labels.length ? labels.join(', ') : 'none'}.`);
  for (const c of sensitive.categories) console.log(`  ${c}: ${safeName(sensitive.files[c].join(', '))}`);
  if (ownerDecision.length) {
    console.log(`Owner decision needed (rules or requirements): ${safeName(ownerDecision.join(', '))} — the body must record it.`);
  }
  if (approval.required) {
    console.log(`Acts on the cloud or production — the owner's approval is needed on the PR: ${safeName(approval.reasons.join('; '))}`);
  }
  const problems = checkDescription({ title, body, ids: requirementIds(path.join(root, 'docs/requirements')), sensitive });
  if (!problems.length) {
    console.log('PR title and description follow CICD-01 FR 2 (the CI job `traceability` will pass on them).');
    return;
  }
  for (const p of problems) console.log(`ERROR ${safeName(p)}`);
  process.exitCode = 1;
}

/** The step after `daily --outputs`: fail the run when the owner must look (the second notification). */
function alerted() {
  console.log('::error::The daily check found violations or items to check: see the alert issue labelled main-check.');
  process.exitCode = 1;
}

/** Git pre-commit hook (.githooks/pre-commit): Prettier and ESLint on the staged files. */
function preCommitHook() {
  process.exitCode = preCommit(process.cwd());
}

const commands = { label, description, changes, daily, alerted, local, 'pre-commit': preCommitHook };
if (!commands[command]) {
  console.error('Usage: node tools/pr-rules/index.mjs label|description|changes|daily|alerted|local|pre-commit [flags]');
  process.exit(2);
}
await commands[command]();
