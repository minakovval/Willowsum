// Створено: 2026-11-14 · Оновлено: 2026-11-16
// Token and time accounting for the issue «Облік токенів» (#180): owner, 2026-11-14, #178 comments 6873950124 (5),
// 6873807074 and 6866721229. Synthetic fixtures only; no network (`--branch` is tested with a fake `gh`).
// Run: node --test tools/token-report
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { addUpByModel, appendRow, archivePrRows, ARCHIVE_LINE, MAX_BODY, collectUsage, ciMinutes, formatRow, main, modelNote, parseRun, sumUsage, UsageError } from "../lib.mjs";

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
      "| #195 | процес | 1 | 464 433 | 8,0 | 5 | 12,0 | 3,0 | 10 | — |",
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
  // The existing columns are unchanged; the note gains the per-model split (the fixtures carry no model).
  const row =
    "| #195 | процес | 1 | 464 433 | 8,0 | 5 | 12,0 | 3,0 | 10 | моделі: unknown 8,0 млн cache read |";

  it("pr: prints the ready row from agent logs and a runs file", () => {
    const r = run([...pr, "--ci-runs", fx("runs.json")]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.split("\n")[0], row);
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
    assert.equal(r.out.split("\n")[0], row);
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

  it("pr: when no --run has log=, it fails with a clear message and prints no row (silent zero, #196)", () => {
    const r = run(["pr", "--pr", "195", "--type", "процес", "--rounds", "1", "--run", "role=author,ms=1,tokens=1", "--ci-runs", fx("runs.json")]);
    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    assert.match(r.err, /no --run has log=/);
  });

  it("pr: a --run without log= among others is named in the note «журнал втрачено» (#196)", () => {
    const r = run([...pr, "--run", "role=confirm,ms=1000,tokens=10", "--ci-runs", fx("runs.json")]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /журнал втрачено: підтвердження/);
  });

  it("pr: a missing log file fails with its path, not a stack trace (#196)", () => {
    const res = spawnSync(
      process.execPath,
      [INDEX, "pr", "--pr", "195", "--type", "процес", "--rounds", "1", "--run", "role=author,log=/nonexistent/a.jsonl,ms=1,tokens=1", "--ci-runs", fx("runs.json")],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /error: .*\/nonexistent\/a\.jsonl/);
    assert.doesNotMatch(res.stderr, /\n\s+at /);
  });

  it("session: an empty --since/--until window warns on stderr (#196)", () => {
    const r = run(["session", fx("lead-session.jsonl"), "--since", "2030-01-01T00:00:00Z"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /warning: no messages in the window/);
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

describe("per-model split (owner, 2026-11-15, #178, comment 6894721169)", () => {
  const rec = (id, model, cacheRead, output, extra = {}) =>
    JSON.stringify({
      type: "assistant",
      message: {
        id,
        ...(model ? { model } : {}),
        usage: { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: cacheRead, output_tokens: output },
      },
      ...extra,
    });
  const byModel = (text) => {
    const seen = new Map();
    collectUsage(text, { path: "x", seen });
    return addUpByModel(seen);
  };

  it("two models in one log are summed separately, largest cache read first", () => {
    const m = byModel(
      [
        rec("a", "claude-opus-5-5", 4_000_000, 100),
        rec("b", "claude-fable-5-2", 1_200_000, 50),
        rec("c", "claude-opus-5-5", 100_000, 7),
      ].join("\n"),
    );
    assert.deepEqual([...m.keys()], ["claude-opus-5-5", "claude-fable-5-2"]);
    assert.deepEqual(m.get("claude-opus-5-5"), { messages: 2, input: 2, cacheCreation: 20, cacheRead: 4_100_000, output: 107 });
    assert.equal(m.get("claude-fable-5-2").cacheRead, 1_200_000);
  });

  it("a record without message.model counts as `unknown`", () => {
    const m = byModel([rec("a", "claude-opus-5-5", 10, 1), rec("b", undefined, 20, 2)].join("\n"));
    assert.deepEqual(m.get("unknown"), { messages: 1, input: 1, cacheCreation: 10, cacheRead: 20, output: 2 });
  });

  it("a duplicate message.id counts once, with the model of the record (a later record without model keeps it)", () => {
    const m = byModel(
      [rec("a", "claude-fable-5-2", 100, 1), rec("a", undefined, 100, 9), rec("a", "claude-fable-5-2", 100, 9)].join("\n"),
    );
    assert.equal(m.size, 1);
    assert.deepEqual(m.get("claude-fable-5-2"), { messages: 1, input: 1, cacheCreation: 10, cacheRead: 100, output: 9 });
  });

  it("modelNote skips models with no cache read (<synthetic>) but byModel keeps them", () => {
    const m = byModel([rec("a", "claude-opus-5-5", 2_000_000, 1), rec("b", "<synthetic>", 0, 0)].join("\n"));
    assert.ok(m.has("<synthetic>"));
    assert.equal(modelNote(m), "моделі: opus 2,0 млн cache read");
  });

  it("pr: prints the row, then one line per model; the note names the families; the row columns stay the same", () => {
    const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/tr-`);
    const log = `${dir}/a.output`;
    fs.writeFileSync(
      log,
      [rec("a", "claude-opus-5-5", 4_100_000, 100), rec("b", "claude-fable-5-2", 1_200_000, 50), rec("b", "claude-fable-5-2", 1_200_000, 60)].join("\n"),
    );
    const r = run(
      ["pr", "--pr", "7", "--type", "код", "--rounds", "1", "--run", `role=author,log=${log},ms=60000,tokens=5`, "--ci-runs", fx("runs.json")],
    );
    assert.equal(r.code, 0, r.err);
    const [row, ...lines] = r.out.split("\n");
    assert.equal(row, "| #7 | код | 1 | 5 | 5,3 | 0 | 1,0 | 0,0 | 10 | моделі: opus 4,1 млн / fable 1,2 млн cache read |");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^ {2}модель claude-opus-5-5: 1 model calls, cache read 4 100 000, cache creation 10, input 1, output 100$/);
    assert.match(lines[1], /модель claude-fable-5-2: 1 model calls, cache read 1 200 000, .*output 60$/);
  });

  it("session: the total, then one line per model; a log with no usage still fails", () => {
    const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/tr-`);
    const file = `${dir}/s.jsonl`;
    fs.writeFileSync(file, [rec("a", "claude-opus-5-5", 10, 1), rec("b", "claude-fable-5-2", 20, 2)].join("\n"));
    const r = run(["session", file]);
    assert.equal(r.code, 0, r.err);
    const lines = r.out.split("\n");
    assert.match(lines[0], /^messages 2 /);
    assert.equal(lines.length, 3);
    assert.match(lines[1], /модель claude-fable-5-2/);
    const bad = run(["session", fx("no-usage.jsonl")]);
    assert.equal(bad.code, 1);
    assert.equal(bad.out, "");
  });
});

describe("append: a row into the body of #180 (owner, 2026-11-15, #178, comment 6899108018)", () => {
  const body = read("body180.md");
  const prRow = "| #195 | процес | 1 | 464 433 | 8,0 | 5 | 12,0 | 3,0 | 10 | автор 204 431 |";
  const sessionRow = "| ведучий 2 | 2026-11-14 | 2,0 млн | 0,2 млн | 2,0 | 2,0 | 2,0 | 0,2 | — |";
  const without = (text, line) => text.replace(`${line}\n`, "");

  it("adds the row after the last row of the table «PR»; every other byte stays the same", () => {
    const out = appendRow(body, prRow);
    const lines = out.split("\n");
    assert.equal(lines[lines.indexOf(prRow) - 1].slice(0, 7), "| #102 ");
    assert.equal(without(out, prRow), body);
  });

  it("--sessions: adds the row to the table «Сесії» instead", () => {
    const out = appendRow(body, sessionRow, { table: "sessions" });
    const lines = out.split("\n");
    assert.match(lines[lines.indexOf(sessionRow) - 1], /^\| ведучий 1 /);
    assert.equal(lines[lines.indexOf(sessionRow) + 1], "");
    assert.equal(without(out, sessionRow), body);
  });

  it("refuses a row with the wrong number of cells, more than one line, or not a table line", () => {
    assert.throws(() => appendRow(body, "| #195 | процес |"), /2 cells, the table «PR» has 10/);
    assert.throws(() => appendRow(body, `${prRow}\n${prRow}`), /one table line/);
    assert.throws(() => appendRow(body, "#195 процес"), /one table line/);
    assert.throws(() => appendRow(body, prRow, { table: "sessions" }), /10 cells, the table «Сесії» has 9/);
  });

  it("refuses a row whose PR or segment is already in the table", () => {
    assert.throws(() => appendRow(body, prRow.replace("#195", "#101")), /already has a row «#101»/);
  });

  it("treats a linked first cell «[#101](url)» as the same row as «#101»", () => {
    assert.throws(() => appendRow(body, prRow.replace("#195", "[#101](https://example.com/pull/101)")), /already has a row/);
  });

  it("appends to a CRLF body and keeps an escaped \\| in a note", () => {
    const crlf = body.replace(/\n/g, "\r\n");
    const row = prRow.replace("#195", "#196").replace(/ \|$/, "") + " \\| x |";
    const out = appendRow(crlf, row);
    assert.ok(out.includes(`${row}\r\n`));
    assert.equal(out.split("\n").length, crlf.split("\n").length + 1);
  });

  it("refuses a body without the table", () => {
    assert.throws(() => appendRow("## Сесії\n\nтекст\n", sessionRow, { table: "sessions" }), /no header and separator/);
    assert.throws(() => appendRow("текст\n", prRow), /no section of the table «PR»/);
  });

  it("CLI: writes the file in place and names the PATCH command; on an error it writes nothing", () => {
    const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/tr-`);
    const file = `${dir}/body.md`;
    fs.writeFileSync(file, body);
    const res = spawnSync(process.execPath, [INDEX, "append", "--body", file, "--row", prRow], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.readFileSync(file, "utf8"), appendRow(body, prRow));
    assert.match(res.stderr, /-F body=@/);
    const again = run(["append", "--body", file, "--sessions", "--row", "| ведучий 1 | x | x | x | x | x | x | x | x |"]);
    assert.equal(again.code, 1);
    assert.equal(fs.readFileSync(file, "utf8"), appendRow(body, prRow));
    assert.match(run(["append", "--body", file]).err, /--body and --row are required/);
  });
});

describe("note cap, body cap and archive (owner, 2026-11-16, #178, comment 6904503474)", () => {
  const body = read("body180.md");
  const prRow = (note) => `| #195 | процес | 1 | 464 433 | 8,0 | 5 | 12,0 | 3,0 | 10 | ${note} |`;

  it("append accepts a note of 120 characters and refuses one of 121 (exit 1, file untouched)", () => {
    assert.doesNotThrow(() => appendRow(body, prRow("н".repeat(120))));
    assert.throws(() => appendRow(body, prRow("н".repeat(121))), /121 characters, the limit is 120/);
    const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/tr-`);
    const file = `${dir}/body.md`;
    fs.writeFileSync(file, body);
    const r = run(["append", "--body", file, "--row", prRow("н".repeat(121))]);
    assert.equal(r.code, 1);
    assert.match(r.err, /«Примітка» cell is 121/);
    assert.equal(fs.readFileSync(file, "utf8"), body);
  });

  it("the note cap applies to the «Сесії» table too", () => {
    const row = `| ведучий 2 | 2026-11-14 | 1 | 1 | 1 | 1 | 1 | 1 | ${"x".repeat(121)} |`;
    assert.throws(() => appendRow(body, row, { table: "sessions" }), /limit is 120/);
  });

  it("pr: a typical row (three agent runs, two models, long --note within reason) passes the cap; the per-agent list is gone", () => {
    const r = run([
      "pr", "--pr", "195", "--type", "процес", "--rounds", "1",
      "--run", `role=author,log=${fx("author.jsonl")},ms=600000,tokens=204431`,
      "--run", `role=fix,log=${fx("fix.jsonl")},ms=120000,tokens=105870`,
      "--run", `role=review,log=${fx("review.jsonl")},ms=180000,tokens=154132`,
      "--ci-runs", fx("runs.json"), "--note", "1 синхронізація",
    ]);
    assert.equal(r.code, 0, r.err);
    const row = r.out.split("\n")[0];
    assert.doesNotMatch(row, /автор 204 431|рецензія 154 132/);
    assert.match(row, /\| 1 синхронізація; моделі: unknown 8,0 млн cache read \|$/);
    assert.doesNotThrow(() => appendRow(body, row));
  });

  it("--note text counts: a long --note makes the row from `pr` fail on append", () => {
    const r = run([
      "pr", "--pr", "7", "--type", "код", "--rounds", "1", "--run", `role=author,log=${fx("author.jsonl")},ms=60000,tokens=5`,
      "--ci-runs", fx("runs.json"), "--note", "д".repeat(100),
    ]);
    assert.equal(r.code, 0, r.err);
    assert.throws(() => appendRow(body, r.out.split("\n")[0]), /limit is 120/);
  });

  it("append refuses when the body would exceed 55 000 characters, naming `archive`; exactly 55 000 passes", () => {
    const row = prRow("x");
    const base = appendRow(body, row).length - body.length; // growth of one append
    const pad = (n) => body + "я".repeat(n);
    const fits = pad(MAX_BODY - body.length - base);
    assert.equal(appendRow(fits, row).length, MAX_BODY);
    const over = pad(MAX_BODY - body.length - base + 1);
    assert.throws(() => appendRow(over, row), (e) => e instanceof UsageError && /archive --body/.test(e.message) && /55000/.test(e.message));
    const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/tr-`);
    const file = `${dir}/body.md`;
    fs.writeFileSync(file, over);
    const r = run(["append", "--body", file, "--row", row]);
    assert.equal(r.code, 1);
    assert.match(r.err, /archive issue/);
    assert.equal(fs.readFileSync(file, "utf8"), over);
  });

  it("archivePrRows: moves the rows, keeps header, separator, placeholder line and every other byte", () => {
    const { body: out, archive, rows } = archivePrRows(body);
    assert.equal(rows, 2);
    assert.ok(archive.includes("| #101 | код |") && archive.includes("| #102 | процес |"));
    assert.match(archive, /^# Архів/);
    assert.ok(archive.includes("| PR | Тип |") && archive.includes("| --- | --- | ---: |"));
    assert.ok(!out.includes("| #101 |") && !out.includes("| #102 |"));
    assert.ok(out.includes(`\n\n${ARCHIVE_LINE}\n`));
    // putting the rows back reproduces the original body byte for byte
    const rowsText = body.split("\n").filter((l) => /^\| #10[12] /.test(l)).join("\n");
    const restored = out.replace(`\n\n${ARCHIVE_LINE}\n`, `\n${rowsText}\n`);
    assert.equal(restored, body);
    // the table «Сесії» and the text after the tables are untouched
    assert.ok(out.startsWith(body.slice(0, body.indexOf("| #101 |"))));
    assert.ok(out.endsWith(body.slice(body.indexOf("\n\n\n**Токени агентів."))));
  });

  it("archivePrRows: refuses a table with no rows; a later append lands right after the separator", () => {
    const { body: out } = archivePrRows(body);
    assert.throws(() => archivePrRows(out), /no rows to archive/);
    const again = appendRow(out, prRow("x"));
    assert.ok(again.includes(`--- |\n${prRow("x")}\n\n${ARCHIVE_LINE}`));
    assert.throws(() => archivePrRows("текст\n"), /no section of the table «PR»/);
  });

  it("archivePrRows (#319): a second run keeps one archive line — the placeholder stays one, a filled link is kept", () => {
    const first = archivePrRows(body).body;
    const second = archivePrRows(appendRow(first, prRow("y"))).body;
    assert.equal(second.split("\n").filter((l) => l.startsWith("Архів рядків PR:")).length, 1);
    assert.ok(second.includes(`\n\n${ARCHIVE_LINE}\n`));
    const filled = first.replace(ARCHIVE_LINE, "Архів рядків PR: https://example.test/1");
    const third = archivePrRows(appendRow(filled, prRow("z"))).body;
    const lines = third.split("\n").filter((l) => l.startsWith("Архів рядків PR:"));
    assert.deepEqual(lines, [`${ARCHIVE_LINE}; раніше: https://example.test/1`]);
  });

  it("CLI archive: writes --out and the body; without --out it fails and writes nothing", () => {
    const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/tr-`);
    const file = `${dir}/body.md`;
    const out = `${dir}/archive.md`;
    fs.writeFileSync(file, body);
    const bad = spawnSync(process.execPath, [INDEX, "archive", "--body", file], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.equal(fs.readFileSync(file, "utf8"), body);
    const res = spawnSync(process.execPath, [INDEX, "archive", "--body", file, "--out", out], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.readFileSync(file, "utf8"), archivePrRows(body).body);
    assert.equal(fs.readFileSync(out, "utf8"), archivePrRows(body).archive);
    assert.match(res.stderr, /Архів рядків PR: <посилання>/);
  });
});
