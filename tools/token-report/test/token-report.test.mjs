// Створено: 2026-11-14 · Оновлено: 2026-11-14
// Token and time accounting for the issue «Облік токенів» (#180): owner, 2026-11-14, #178 comments 6873950124 (5),
// 6873807074 and 6866721229. Synthetic fixtures only; no network (`--branch` is tested with a fake `gh`).
// Run: node --test tools/token-report
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ciMinutes, formatRow, main, parseRun, sumUsage, UsageError } from "../lib.mjs";

const fx = (name) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const read = (name) => fs.readFileSync(fx(name), "utf8");
const INDEX = fileURLToPath(new URL("../index.mjs", import.meta.url));

/** Runs `main` with captured output; `gh` is a fake that returns the given JSON text. */
function run(argv, gh) {
  const out = [];
  const err = [];
  const code = main(argv, {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    gh: gh ?? (() => assert.fail("gh must not be called")),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("sumUsage: real spend from an agent log (#178, comment 6873807074)", () => {
  it("sums input, cache creation, cache read and output; each model message.id once (its last record)", () => {
    const u = sumUsage(read("author.jsonl"), { path: "author.jsonl" });
    assert.deepEqual(u, {
      messages: 2,
      input: 3,
      cacheCreation: 200,
      cacheRead: 3_500_000,
      output: 2000,
      sidechainSkipped: 0,
    });
  });

  it("fails on a log with no `usage` fields at all instead of counting zero", () => {
    assert.throws(
      () => sumUsage(read("no-usage.jsonl"), { path: "no-usage.jsonl" }),
      (e) => e instanceof UsageError && /no-usage\.jsonl/.test(e.message) && /no `usage`/.test(e.message),
    );
  });

  it("fails on a line that is not JSON, naming the file and line", () => {
    assert.throws(
      () => sumUsage(read("broken.jsonl"), { path: "broken.jsonl" }),
      (e) => e instanceof UsageError && /broken\.jsonl:1/.test(e.message),
    );
  });

  it("session mode: skips sidechain records and filters by --since / --until", () => {
    const all = sumUsage(read("lead-session.jsonl"), { path: "s", skipSidechain: true });
    assert.equal(all.cacheRead, 600_000);
    assert.equal(all.output, 1100);
    assert.equal(all.sidechainSkipped, 1);
    const window = sumUsage(read("lead-session.jsonl"), {
      path: "s",
      skipSidechain: true,
      since: "2026-01-01T08:15:00Z",
      until: "2026-01-01T10:00:00Z",
    });
    assert.equal(window.messages, 1);
    assert.equal(window.cacheRead, 200_000);
  });
});

describe("ciMinutes: GitHub Actions runs of the PR branch (#178, comment 6866721229)", () => {
  it("sums run_started_at → updated_at of every run, in minutes", () => {
    assert.deepEqual(ciMinutes(JSON.parse(read("runs.json"))), { runs: 3, minutes: 10, unfinished: 0 });
  });

  it("accepts the pages of `gh api --paginate --slurp` (an array of responses)", () => {
    const page = JSON.parse(read("runs.json"));
    const pages = [
      { total_count: 3, workflow_runs: page.workflow_runs.slice(0, 2) },
      { total_count: 3, workflow_runs: page.workflow_runs.slice(2) },
    ];
    assert.equal(ciMinutes(pages).minutes, 10);
  });

  it("fails when the response holds fewer runs than total_count", () => {
    assert.throws(() => ciMinutes(JSON.parse(read("runs-truncated.json"))), /1 of 150 runs/);
  });

  it("fails on a run without run_started_at", () => {
    assert.throws(
      () => ciMinutes({ total_count: 1, workflow_runs: [{ id: 9, updated_at: "2026-01-01T10:00:00Z" }] }),
      /run 9/,
    );
  });
});

describe("parseRun: one agent run per --run", () => {
  it("reads role, log, duration_ms and subagent_tokens", () => {
    assert.deepEqual(parseRun("role=review,log=/x/tasks/a.output,ms=180000,tokens=154132"), {
      role: "review",
      log: "/x/tasks/a.output",
      ms: 180000,
      tokens: 154132,
    });
  });

  it("rejects an unknown role and a missing ms or tokens", () => {
    assert.throws(() => parseRun("role=lead,log=a,ms=1,tokens=1"), /role/);
    assert.throws(() => parseRun("role=author,log=a,tokens=1"), /ms/);
    assert.throws(() => parseRun("role=author,log=a,ms=1"), /tokens/);
  });
});

describe("formatRow: the row of the table «PR» in #180", () => {
  it("columns PR | Тип | Раунди | subagent_tokens | cache read, млн | output, тис. | автор, хв | рецензії, хв | CI, хв | Примітка", () => {
    const row = formatRow({
      pr: "195",
      type: "процес",
      rounds: "1",
      runs: [
        { role: "author", ms: 600000, tokens: 204431 },
        { role: "fix", ms: 120000, tokens: 105870 },
        { role: "review", ms: 180000, tokens: 154132 },
      ],
      usage: { cacheRead: 8_000_000, output: 5000 },
      ci: 10,
      note: "",
    });
    assert.equal(
      row,
      "| #195 | процес | 1 | 464 433 | 8,0 | 5 | 12,0 | 3,0 | 10 | автор 204 431, виправлення 105 870, рецензія 154 132 |",
    );
  });
});

describe("CLI", () => {
  const pr = [
    "pr",
    "--pr",
    "195",
    "--type",
    "процес",
    "--rounds",
    "1",
    "--run",
    `role=author,log=${fx("author.jsonl")},ms=600000,tokens=204431`,
    "--run",
    `role=fix,log=${fx("fix.jsonl")},ms=120000,tokens=105870`,
    "--run",
    `role=review,log=${fx("review.jsonl")},ms=180000,tokens=154132`,
  ];
  const row =
    "| #195 | процес | 1 | 464 433 | 8,0 | 5 | 12,0 | 3,0 | 10 | автор 204 431, виправлення 105 870, рецензія 154 132 |";

  it("pr: prints the ready row from agent logs and a runs file", () => {
    const r = run([...pr, "--ci-runs", fx("runs.json")]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, row);
  });

  it("pr: a message.id that appears in two logs (a resumed agent's log passed twice) counts once", () => {
    const r = run([
      ...pr,
      "--run",
      `role=author,log=${fx("author.jsonl")},ms=0,tokens=0`,
      "--ci-runs",
      fx("runs.json"),
    ]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /\| 8,0 \| 5 \|/);
  });

  it("pr --branch: reads the runs through `gh api` (fake here)", () => {
    let asked;
    const r = run([...pr, "--branch", "claude/x"], (args) => {
      asked = args;
      return read("runs.json");
    });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(asked, ["api", "repos/{owner}/{repo}/actions/runs?branch=claude%2Fx&per_page=100"]);
    assert.equal(r.out, row);
  });

  it("pr: exits non-zero with a clear message, and prints no row, when a log has no usage", () => {
    const res = spawnSync(
      process.execPath,
      [
        INDEX,
        ...pr,
        "--run",
        `role=review,log=${fx("no-usage.jsonl")},ms=1,tokens=1`,
        "--ci-runs",
        fx("runs.json"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /no-usage\.jsonl: no `usage` fields/);
  });

  it("pr: without --ci-runs or --branch it fails", () => {
    const r = run(pr);
    assert.equal(r.code, 1);
    assert.match(r.err, /--ci-runs|--branch/);
  });

  it("session: sums the lead's own transcript (get_session no longer returns usage)", () => {
    const out = execFileSync(process.execPath, [INDEX, "session", fx("lead-session.jsonl")], {
      encoding: "utf8",
    });
    assert.match(out, /cache read 0,6 млн/);
    assert.match(out, /output 1 100/);
    assert.match(out, /1 sidechain/);
  });
});
