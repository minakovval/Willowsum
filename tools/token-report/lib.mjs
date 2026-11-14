// Створено: 2026-11-14 · Оновлено: 2026-11-14
// Token and time accounting for the issue «Облік токенів» (#180); owner, 2026-11-14 (#178, comment 6873950124, item 5).
// Pure functions plus `main` with injected I/O, so the tests need no network. Zero dependencies, Node 22.
import fs from "node:fs";

export class UsageError extends Error {}

/** Roles of an agent run → the #180 time column they add to. */
const ROLES = {
  author: { column: "author", label: "автор" },
  fix: { column: "author", label: "виправлення" },
  review: { column: "review", label: "рецензія" },
  security: { column: "review", label: "безпека" },
  confirm: { column: "review", label: "підтвердження" },
};

const FIELDS = [
  ["input", "input_tokens"],
  ["cacheCreation", "cache_creation_input_tokens"],
  ["cacheRead", "cache_read_input_tokens"],
  ["output", "output_tokens"],
];

/**
 * Collects the `message.usage` of every model call in a JSONL agent log or session transcript into `seen`
 * (message.id → usage; a later record of the same id replaces the earlier one: streamed records repeat it).
 * Throws UsageError on a line that is not JSON and on a log with no usage at all.
 * @returns {{ records: number, sidechainSkipped: number }}
 */
export function collectUsage(text, { path, seen, skipSidechain = false, since, until }) {
  const from = since ? Date.parse(since) : -Infinity;
  const to = until ? Date.parse(until) : Infinity;
  let records = 0;
  let sidechainSkipped = 0;
  let anonymous = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      throw new UsageError(
        `${path}:${i + 1}: not a JSON line — is this a JSONL agent log or session transcript?`,
      );
    }
    const usage = rec?.message?.usage;
    if (!usage || typeof usage !== "object") continue;
    records++;
    if (skipSidechain && rec.isSidechain === true) {
      sidechainSkipped++;
      continue;
    }
    const at = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if ((since || until) && !(at >= from && at < to)) continue;
    const id = rec.message.id ?? `${path}#${anonymous++}`;
    seen.set(id, usage);
  }
  if (records === 0) {
    throw new UsageError(
      `${path}: no \`usage\` fields in ${lines.filter((l) => l.trim()).length} lines — the log format may have ` +
        "changed or this is not an agent log; refusing to count zero",
    );
  }
  return { records, sidechainSkipped };
}

/** Sums the four usage fields of the collected messages. */
export function addUp(seen) {
  const acc = { messages: seen.size, input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  for (const usage of seen.values()) {
    for (const [key, field] of FIELDS) {
      const n = usage[field] ?? 0;
      if (!Number.isFinite(n)) throw new UsageError(`usage.${field} is not a number: ${JSON.stringify(n)}`);
      acc[key] += n;
    }
  }
  return acc;
}

/** One log or transcript: its usage sums (each message.id once). */
export function sumUsage(text, opts) {
  const seen = new Map();
  const { sidechainSkipped } = collectUsage(text, { ...opts, seen });
  return { ...addUp(seen), sidechainSkipped };
}

/**
 * Minutes of GitHub Actions runs, `run_started_at` → `updated_at` each (#178, comment 6866721229). Takes the
 * response of `gh api "repos/{owner}/{repo}/actions/runs?branch=<b>&per_page=100"`, or an array of such pages.
 */
export function ciMinutes(json) {
  const pages = Array.isArray(json) ? json : [json];
  const runs = pages.flatMap((p) => p?.workflow_runs ?? []);
  const expected = Math.max(0, ...pages.map((p) => p?.total_count ?? 0));
  if (runs.length < expected) {
    throw new UsageError(
      `got ${runs.length} of ${expected} runs: fetch every page (gh api --paginate --slurp …) and pass the result`,
    );
  }
  let seconds = 0;
  let unfinished = 0;
  for (const r of runs) {
    const start = Date.parse(r.run_started_at);
    const end = Date.parse(r.updated_at);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new UsageError(`run ${r.id}: no run_started_at or updated_at`);
    }
    if (r.status && r.status !== "completed") unfinished++;
    seconds += Math.max(0, end - start) / 1000;
  }
  return { runs: runs.length, minutes: seconds / 60, unfinished };
}

/** `role=<author|fix|review|security|confirm>,log=<path>,ms=<duration_ms>,tokens=<subagent_tokens>` (log optional). */
export function parseRun(spec) {
  const kv = Object.fromEntries(
    spec.split(",").map((part) => {
      const at = part.indexOf("=");
      return at < 0 ? [part, ""] : [part.slice(0, at), part.slice(at + 1)];
    }),
  );
  if (!ROLES[kv.role]) {
    throw new UsageError(`--run ${spec}: role must be one of ${Object.keys(ROLES).join(", ")}`);
  }
  const int = (key, what) => {
    if (!/^\d+$/.test(kv[key] ?? "")) throw new UsageError(`--run ${spec}: ${key}=<${what}> is required`);
    return Number.parseInt(kv[key], 10);
  };
  return {
    role: kv.role,
    log: kv.log || undefined,
    ms: int("ms", "duration_ms"),
    tokens: int("tokens", "subagent_tokens"),
  };
}

/** 485196 → «485 196». */
export const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
/** 13.24 → «13,2». */
export const oneDecimal = (n) => {
  const [whole, frac] = (Math.round(n * 10) / 10).toFixed(1).split(".");
  return `${grouped(Number(whole))},${frac}`;
};

/** The row of the table «PR» in #180. */
export function formatRow({ pr, type, rounds, runs, usage, ci, note }) {
  const minutes = (column) =>
    runs.filter((r) => ROLES[r.role].column === column).reduce((a, r) => a + r.ms, 0) / 60000;
  const tokens = runs.reduce((a, r) => a + r.tokens, 0);
  const byRole = new Map();
  for (const r of runs) byRole.set(r.role, [...(byRole.get(r.role) ?? []), grouped(r.tokens)]);
  const auto = [...byRole].map(([role, list]) => `${ROLES[role].label} ${list.join(" + ")}`).join(", ");
  const cells = [
    `#${String(pr).replace(/^#/, "")}`,
    type,
    rounds,
    grouped(tokens),
    oneDecimal(usage.cacheRead / 1e6),
    grouped(usage.output / 1000),
    oneDecimal(minutes("author")),
    oneDecimal(minutes("review")),
    grouped(ci),
    [auto, note].filter(Boolean).join("; "),
  ];
  return `| ${cells.join(" | ")} |`;
}

const USAGE = `usage:
  node tools/token-report/index.mjs pr --pr <n> --type <код|UI|вимоги|процес|виправлення> --rounds <text>
      --run role=<author|fix|review|security|confirm>,log=<agent log>,ms=<duration_ms>,tokens=<subagent_tokens> [--run …]
      (--ci-runs <runs.json> | --branch <PR branch>) [--note <text>]
  node tools/token-report/index.mjs session <transcript.jsonl> [--since <ISO time>] [--until <ISO time>]`;

function options(argv) {
  const opts = { run: [], positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      opts.positional.push(a);
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new UsageError(`${a} needs a value`);
    const key = a.slice(2);
    if (key === "run") opts.run.push(value);
    else opts[key] = value;
  }
  return opts;
}

/**
 * CLI. `io`: { stdout(text), stderr(text), gh(args) → stdout text, readFile(path) → text }.
 * @returns {number} exit code
 */
export function main(argv, io) {
  const readFile = io.readFile ?? ((p) => fs.readFileSync(p, "utf8"));
  try {
    const [mode, ...rest] = argv;
    const opts = options(rest);
    if (mode === "session") {
      const file = opts.positional[0];
      if (!file) throw new UsageError(USAGE);
      const u = sumUsage(readFile(file), {
        path: file,
        skipSidechain: true,
        since: opts.since,
        until: opts.until,
      });
      io.stdout(
        `messages ${grouped(u.messages)} · input ${grouped(u.input)} · cache creation ${grouped(u.cacheCreation)} · ` +
          `cache read ${oneDecimal(u.cacheRead / 1e6)} млн (${grouped(u.cacheRead)}) · output ${grouped(u.output)} · ` +
          `${u.sidechainSkipped} sidechain records skipped`,
      );
      return 0;
    }
    if (mode !== "pr") throw new UsageError(USAGE);
    for (const key of ["pr", "type", "rounds"])
      if (!opts[key]) throw new UsageError(`--${key} is required\n${USAGE}`);
    if (opts.run.length === 0) throw new UsageError(`at least one --run is required\n${USAGE}`);
    const runs = opts.run.map(parseRun);
    const seen = new Map();
    for (const log of new Set(runs.map((r) => r.log).filter(Boolean))) {
      collectUsage(readFile(log), { path: log, seen });
    }
    let runsJson;
    if (opts["ci-runs"]) runsJson = readFile(opts["ci-runs"]);
    else if (opts.branch) {
      runsJson = io.gh([
        "api",
        `repos/{owner}/{repo}/actions/runs?branch=${encodeURIComponent(opts.branch)}&per_page=100`,
      ]);
    } else throw new UsageError(`--ci-runs <file> or --branch <name> is required\n${USAGE}`);
    let parsed;
    try {
      parsed = JSON.parse(runsJson);
    } catch {
      throw new UsageError("the GitHub Actions runs are not JSON");
    }
    const ci = ciMinutes(parsed);
    if (ci.unfinished > 0) io.stderr(`warning: ${ci.unfinished} of ${ci.runs} runs are not completed yet`);
    const usage = addUp(seen);
    io.stderr(
      `agents: ${usage.messages} model calls, cache read ${grouped(usage.cacheRead)}, cache creation ` +
        `${grouped(usage.cacheCreation)}, input ${grouped(usage.input)}, output ${grouped(usage.output)}; CI ${ci.runs} runs`,
    );
    io.stdout(
      formatRow({
        pr: opts.pr,
        type: opts.type,
        rounds: opts.rounds,
        runs,
        usage,
        ci: ci.minutes,
        note: opts.note,
      }),
    );
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.stderr(`error: ${e.message}`);
    return 1;
  }
}
