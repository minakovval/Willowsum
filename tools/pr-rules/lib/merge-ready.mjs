// Створено: 2026-11-27 · Оновлено: 2026-11-27
// Step 6 of the lead's merge checklist as one tool (owner, 2026-11-27, process review 35, item 2): one line per
// condition and a final READY / NOT READY. REST only, through `gh api` (GraphQL is blocked). `gh` is injected so
// the tests feed canned answers; nothing here writes to GitHub.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verdictOf } from './daily.mjs';

const run = promisify(execFile);
const sleepReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TRANSIENT = /HTTP 50[23]|token store unavailable/;

/** `gh api <args>` → stdout. On 502/503 retries after 10 s, 30 s, 90 s (`.claude/references/github-errors.md`). */
export async function ghApi(args, { retryMs = Number(process.env.MERGE_READY_RETRY_MS ?? 10000) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await run('gh', ['api', ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout;
    } catch (e) {
      const text = `${e.stderr ?? ''}${e.message}`;
      if (!TRANSIENT.test(text) || attempt >= 3) throw new Error(`gh api ${args[0]}: ${text.slice(0, 300)}`);
      await sleepReal(retryMs * [1, 3, 9][attempt]);
    }
  }
}

const json = async (gh, args) => JSON.parse(await gh(args));
// --paginate --slurp: one array of pages.
const paged = async (gh, path) => (JSON.parse(await gh([path, '--paginate', '--slurp']))).flat();
const short = (s) => (s ?? '').slice(0, 7);

async function checkRuns(gh, sha) {
  const pages = JSON.parse(await gh([`repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`, '--paginate', '--slurp']));
  return pages.flatMap((p) => p.check_runs ?? []);
}

function ciVerdict(runs, sha) {
  if (runs.length === 0) return { done: false, ok: false, text: `CI: no check runs yet on ${short(sha)} (not finished)` };
  const open = runs.filter((r) => r.status !== 'completed');
  if (open.length) return { done: false, ok: false, text: `CI: ${open.length} of ${runs.length} check runs not completed on ${short(sha)} (${open.map((r) => r.name).join(', ')})` };
  const bad = runs.filter((r) => r.conclusion !== 'success' && r.conclusion !== 'skipped');
  if (bad.length) return { done: true, ok: false, text: `CI: not green on ${short(sha)}: ${bad.map((r) => `${r.name}=${r.conclusion}`).join(', ')}` };
  const skipped = runs.filter((r) => r.conclusion === 'skipped').length;
  return { done: true, ok: true, text: `CI: ${runs.length} check runs success/skipped on ${short(sha)}${skipped ? ` (${skipped} skipped)` : ''}` };
}

/** The latest review (by submitted_at) with a verdict line of `kind`: `{ verdict, commit, id }` or null. */
export function latestVerdict(reviews, kind) {
  const given = reviews
    .filter((r) => r.state !== 'DISMISSED' && r.state !== 'PENDING' && r.submitted_at)
    .map((r) => ({ verdict: verdictOf(r.body ?? '', kind), commit: r.commit_id, id: r.id, at: Date.parse(r.submitted_at) }))
    .filter((v) => v.verdict)
    .sort((a, b) => a.at - b.at || a.id - b.id);
  return given.at(-1) ?? null;
}

function verdictLine(reviews, kind, head) {
  const name = kind === 'security' ? 'Security verdict' : 'Verdict';
  const v = latestVerdict(reviews, kind);
  if (!v) return { ok: false, text: `${name}: none on the PR` };
  if (v.verdict !== 'Ready') return { ok: false, text: `${name}: latest is «${v.verdict}» (review ${v.id} on ${short(v.commit)})` };
  if (v.commit !== head) return { ok: false, text: `${name}: latest Ready is on ${short(v.commit)}, head is ${short(head)}` };
  return { ok: true, text: `${name}: Ready on ${short(head)} (review ${v.id})` };
}

/** The «sync only when needed» check: the checklist's node snippet. `mainFiles` = file names main changed. */
export function syncNeeded({ count, mainFiles, prFiles }) {
  const pr = new Set(prFiles);
  const mod = (f) => /^apps\/api\/src\/modules\/([^/]+)\//.exec(f)?.[1];
  const mods = new Set([...pr].map(mod).filter(Boolean));
  const why = (f) =>
    pr.has(f) ? 'PR file'
    : f.startsWith('packages/api-contract/') && !['packages/api-contract/openapi.json', 'packages/api-contract/src/schema.ts'].includes(f) ? 'api-contract'
    : f === 'apps/api/module-rules.json' ? 'module-rules'
    : f.includes('/migrations/') && mods.has(mod(f)) ? 'migration'
    : '';
  const bad = mainFiles.filter(why).map((f) => `${f} (${why(f)})`);
  if (!Number.isInteger(count) || count >= 300) return { needed: true, text: 'sync: no or truncated file list' };
  return bad.length ? { needed: true, text: `sync: ${bad.join(' ')}` } : { needed: false, text: 'no sync needed' };
}

async function syncLine(gh, n, head) {
  const cmp = await json(gh, [`repos/{owner}/{repo}/compare/${head}...main`]);
  const files = cmp.files ?? [];
  const mainFiles = files.flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]);
  const prFiles = (await paged(gh, `repos/{owner}/{repo}/pulls/${n}/files?per_page=100`)).flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]);
  const r = syncNeeded({ count: files.length, mainFiles, prFiles });
  return { ok: !r.needed, text: r.text };
}

/** `mergeable_state` with `unknown` asked again a few times. */
async function mergeState(gh, n, sleep, tries = 4) {
  let state;
  for (let i = 0; i < tries; i++) {
    state = (await json(gh, [`repos/{owner}/{repo}/pulls/${n}`])).mergeable_state;
    if (state !== 'unknown') break;
    if (i < tries - 1) await sleep(5000);
  }
  return state;
}

/** Evaluate one PR. Returns `{ ready, lines }`; every line is `ok`, `FAIL` or `READ` (information for the lead). */
export async function evaluate(n, { gh, sleep = sleepReal } = {}) {
  const pr = await json(gh, [`repos/{owner}/{repo}/pulls/${n}`]);
  const head = pr.head.sha;
  const labels = (pr.labels ?? []).map((l) => l.name);
  const sensitive = labels.some((l) => l === 'sensitive' || l.startsWith('sensitive:'));
  const reviews = await paged(gh, `repos/{owner}/{repo}/pulls/${n}/reviews?per_page=100`);
  const lines = [];
  const add = (ok, text) => lines.push({ ok, text });
  add(true, `head ${head}${sensitive ? ' (sensitive)' : ''}`);

  const ci = ciVerdict(await checkRuns(gh, head), head);
  add(ci.ok, ci.text);
  const v = verdictLine(reviews, 'review', head);
  add(v.ok, v.text);
  if (sensitive) {
    const s = verdictLine(reviews, 'security', head);
    add(s.ok, s.text);
  }
  if (labels.includes('owner-decision')) {
    const has = /^.*Рішення власника \(/m.test(pr.body ?? '');
    add(has, has ? 'owner-decision: body has a «Рішення власника (» line (the decision log: lead checks)' : 'owner-decision: body has no «Рішення власника (» line');
  }
  const state = await mergeState(gh, n, sleep);
  add(state !== 'dirty' && state !== 'unknown', `mergeable_state: ${state}${state === 'dirty' ? ' (conflict; CI does not run on it)' : state === 'unknown' ? ' (still unknown, ask again)' : ''}`);
  const sync = await syncLine(gh, n, head);
  add(sync.ok, sync.text);

  // Comments since the last review: the lead reads them (owner «stop», questions).
  const comments = await paged(gh, `repos/{owner}/{repo}/issues/${n}/comments?per_page=100`);
  const lastReview = Math.max(0, ...reviews.filter((r) => r.submitted_at).map((r) => Date.parse(r.submitted_at)));
  const fresh = comments.filter((c) => Date.parse(c.created_at) > lastReview);
  const ready = lines.every((l) => l.ok);
  const out = lines.map((l) => `${l.ok ? 'ok  ' : 'FAIL'} ${l.text}`);
  out.push(fresh.length ? `READ ${fresh.length} comment(s) since the last review (read them; owner «stop» or questions block the merge):` : 'READ no comments since the last review');
  for (const c of fresh) out.push(`     ${c.user?.login}\t${c.created_at}\t${(c.body ?? '').slice(0, 200).replace(/\s+/g, ' ')}`);
  out.push(ready ? 'READY' : 'NOT READY');
  return { ready, lines: out };
}

/** `--wait`: poll every 60 s until the CI of every PR has finished (no check runs yet = not finished). */
export async function waitCi(numbers, { gh, sleep = sleepReal, log = () => {}, intervalMs = 60000 } = {}) {
  for (;;) {
    let left = 0;
    for (const n of numbers) {
      try {
        const head = (await json(gh, [`repos/{owner}/{repo}/pulls/${n}`])).head.sha;
        if (!ciVerdict(await checkRuns(gh, head), head).done) left++;
      } catch {
        left++;
      }
    }
    if (left === 0) return;
    log(`waiting for CI of ${left} of ${numbers.length} PR(s)…`);
    await sleep(intervalMs);
  }
}

/** CLI body. Returns the exit code: 0 all READY, 1 some NOT READY, 2 usage. */
export async function main(argv, { gh = ghApi, sleep = sleepReal, out = (s) => console.log(s), err = (s) => console.error(s), intervalMs = 60000 } = {}) {
  const wait = argv.includes('--wait');
  const numbers = argv.filter((a) => a !== '--wait');
  if (!numbers.length || !numbers.every((a) => /^\d+$/.test(a))) {
    err('usage: node tools/pr-rules/merge-ready.mjs [--wait] <PR> [<PR>…]');
    return 2;
  }
  if (wait) await waitCi(numbers, { gh, sleep, log: err, intervalMs });
  let all = true;
  for (const n of numbers) {
    if (numbers.length > 1) out(`== PR #${n}`);
    const r = await evaluate(n, { gh, sleep });
    r.lines.forEach((l) => out(l));
    all &&= r.ready;
  }
  return all ? 0 : 1;
}
