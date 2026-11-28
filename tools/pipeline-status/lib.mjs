// Створено: 2026-11-28 · Оновлено: 2026-11-28
// One-call state of open PRs for the lead (owner, 2026-11-28, token review, proposal 3): one line per PR instead of
// several `gh api` calls each. REST only, through `gh api` and the helpers of tools/pr-rules/lib/merge-ready.mjs.
// `gh` is injected so the tests feed canned answers; nothing here writes to GitHub.
import { ghApi, latestVerdict, checkRuns } from '../pr-rules/lib/merge-ready.mjs';
import { parseLedger } from '../token-report/lib.mjs';

const OK = new Set(['success', 'skipped', 'neutral']);
const stamp = (r) => Date.parse(r.started_at ?? r.completed_at ?? '') || 0;

/**
 * CI of a head from its check runs, by check name: the latest run of a name decides. A cancelled latest run counts as
 * superseded (not red) when the same name succeeded in another run. Returns { state: 'green'|'running'|'red'|'none',
 * text } where text is «green 12», «green 12 (2 superseded)», «running 3: web, api» or «red: api=failure».
 */
export function ciSummary(runs) {
  if (runs.length === 0) return { state: 'none', text: 'none yet' };
  const byName = new Map();
  for (const r of runs) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  let green = 0;
  let superseded = 0;
  const running = [];
  const red = [];
  for (const [name, list] of byName) {
    const sorted = [...list].sort((a, b) => stamp(a) - stamp(b) || (a.id ?? 0) - (b.id ?? 0));
    const last = sorted.at(-1);
    const succeeded = sorted.some((r) => r.status === 'completed' && OK.has(r.conclusion));
    if (last.status !== 'completed') running.push(name);
    else if (OK.has(last.conclusion) || (last.conclusion === 'cancelled' && succeeded)) {
      green++;
      superseded += sorted.filter((r) => r.conclusion === 'cancelled').length;
    } else red.push(`${name}=${last.conclusion}`);
  }
  const tail = superseded ? ` (${superseded} superseded)` : '';
  if (red.length) return { state: 'red', text: `red: ${red.join(', ')}` };
  if (running.length) return { state: 'running', text: `running ${running.length} of ${byName.size}: ${running.join(', ')}` };
  return { state: 'green', text: `green ${green}${tail}` };
}

/** «Ready» / «Changes requested» of the latest review of `kind` that names exactly `head`, or «none». Reviews of other accounts are no verdicts (as merge-ready). */
export function verdictOnHead(reviews, kind, head, owner) {
  const mine = reviews.filter((r) => owner && r.user?.login === owner && r.commit_id === head);
  return latestVerdict(mine, kind)?.verdict ?? 'none';
}

const paged = async (gh, path) => JSON.parse(await gh([path, '--paginate', '--slurp'])).flat();
const json = async (gh, args) => JSON.parse(await gh(args));

/** Numbers of every open PR, oldest first. */
export async function openPrs(gh) {
  return (await paged(gh, 'repos/{owner}/{repo}/pulls?state=open&per_page=100')).map((p) => p.number).sort((a, b) => a - b);
}

/** `#12 a:S aaa, r:O rrr` — ledger entries of a PR as `role:model agentId`. */
export function agentsOf(ledger, n) {
  return ledger.filter((l) => l.pr === `#${n}`).map((l) => `${l.role}:${l.model} ${l.agentId}`).join(', ') || '—';
}

/** The facts of one PR (the line is `formatLine(status)`). */
export async function status(n, { gh, ledger }) {
  const pr = await json(gh, [`repos/{owner}/{repo}/pulls/${n}`]);
  const head = pr.head.sha;
  const labels = (pr.labels ?? []).map((l) => l.name);
  const owner = pr.base?.repo?.owner?.login;
  const sensitive = labels.some((l) => l === 'sensitive' || l.startsWith('sensitive:'));
  const [runs, reviews, cmp] = await Promise.all([
    checkRuns(gh, head),
    paged(gh, `repos/{owner}/{repo}/pulls/${n}/reviews?per_page=100`),
    json(gh, [`repos/{owner}/{repo}/compare/main...${head}?per_page=1`]),
  ]);
  return {
    n,
    head,
    draft: Boolean(pr.draft),
    ci: ciSummary(runs),
    verdict: verdictOnHead(reviews, 'review', head, owner),
    security: sensitive ? verdictOnHead(reviews, 'security', head, owner) : 'n/a',
    behind: cmp.behind_by,
    mergeable: pr.mergeable_state,
    labels,
    agents: ledger ? agentsOf(ledger, n) : undefined,
  };
}

/** One line: `#772 → <sha> | CI … | Verdict: … | Security verdict: … | behind N | state | labels | agents`. */
export function formatLine(s) {
  const parts = [
    `#${s.n} → ${s.head}${s.draft ? ' (draft)' : ''}`,
    `CI ${s.ci.text}`,
    `Verdict: ${s.verdict}`,
    `Security verdict: ${s.security}`,
    `behind ${s.behind ?? '?'}`,
    s.mergeable ?? 'unknown',
    s.labels.length ? s.labels.join(',') : 'no labels',
  ];
  if (s.agents !== undefined) parts.push(`agents ${s.agents}`);
  return parts.join(' | ');
}

const USAGE = 'usage: node tools/pipeline-status/index.mjs [--ledger <ledger.tsv>] [<PR> …]   (no numbers: every open PR)';

/** CLI body. Exit 0 listed, 1 some PR could not be read, 2 usage. */
export async function main(argv, { gh = ghApi, readFile, out = (s) => console.log(s), err = (s) => console.error(s), concurrency = 4 } = {}) {
  let ledgerPath;
  const numbers = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ledger') ledgerPath = argv[++i];
    else if (/^#?\d+$/.test(argv[i])) numbers.push(Number(argv[i].replace('#', '')));
    else {
      err(USAGE);
      return 2;
    }
  }
  if (argv.includes('--ledger') && !ledgerPath) {
    err(USAGE);
    return 2;
  }
  let ledger;
  try {
    if (ledgerPath) ledger = parseLedger(readFile(ledgerPath), ledgerPath);
    const list = numbers.length ? numbers : await openPrs(gh);
    if (list.length === 0) {
      out('no open PRs');
      return 0;
    }
    const lines = new Array(list.length);
    let failed = false;
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        try {
          lines[i] = formatLine(await status(list[i], { gh, ledger }));
        } catch (e) {
          failed = true;
          lines[i] = `#${list[i]} → ERROR ${String(e.message).slice(0, 200)}`;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    lines.forEach((l) => out(l));
    return failed ? 1 : 0;
  } catch (e) {
    err(`error: ${e.message}`);
    return 2;
  }
}
