#!/usr/bin/env node
// CICD-01 (ADR-0008) entry point for the workflows. Subcommands:
//   label        — PR job: label a sensitive PR by its file paths (`sensitive`, `sensitive:<category>`).
//   description  — PR job: title starts with an existing requirement ID; the description follows the template.
//   daily        — scheduled job: check main and the PRs merged into it; open or update the alert issue.
//                  Flags: --since <ISO> --until <ISO> (default: the last 25 hours), --save-input <file>,
//                  --input <file> (evaluate a recorded input, no network), --issue (write the alert issue).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDescription, requirementIds } from './lib/description.mjs';
import { evaluate, needsAlert, render } from './lib/daily.mjs';
import { fetchDailyInput, upsertAlertIssue } from './lib/fetch.mjs';
import { client, ensureLabel } from './lib/github.mjs';
import { classifyPaths, labelsFor } from './lib/paths.mjs';

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

async function label() {
  const pr = pullRequestEvent();
  const gh = client();
  const files = await changedFiles(gh, pr.number);
  const result = classifyPaths(files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)));
  const labels = labelsFor(result);
  console.log(result.sensitive ? `Sensitive: ${result.categories.join(', ')}` : 'Not sensitive by file paths.');
  for (const c of result.categories) console.log(`  ${c}: ${result.files[c].slice(0, 10).join(', ')}`);
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
    await ensureLabel(gh, name, 'b60205', 'CICD-01 FR 4: needs a security review (set by file paths)');
  }
  // Labels are only added, never removed: a later push cannot take the mark away.
  await gh.post(`/{repo}/issues/${pr.number}/labels`, { labels });
}

async function description() {
  const pr = pullRequestEvent();
  const gh = client();
  const files = await changedFiles(gh, pr.number);
  const sensitive = classifyPaths(files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)));
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
  for (const p of problems) console.log(`::error::${p}`);
  summary(['**Опис PR не відповідає CICD-01 п. 2:**', '', ...problems.map((p) => `- ${p}`)].join('\n'));
  process.exitCode = 1;
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
    const since = flag('--since') ? date(flag('--since')) : new Date(until.getTime() - 25 * 3600 * 1000);
    if (since >= until) throw new Error('--since must be before --until');
    input = await fetchDailyInput(client(), { since, until });
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
  if (needsAlert(result)) process.exitCode = 1;
}

const commands = { label, description, daily };
if (!commands[command]) {
  console.error('Usage: node tools/pr-rules/index.mjs label|description|daily [flags]');
  process.exit(2);
}
await commands[command]();
