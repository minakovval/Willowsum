// Створено: 2026-11-27 · Оновлено: 2026-11-27
// The lead's Stop hook: messages to the owner in Ukrainian (decision log 2026-11-27-owner-language-hook.md). No network.
// Fixtures: test/fixtures/*.jsonl, synthetic transcripts. Run: node --test tools/lead-hooks
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { REASON, hookOutput, letterCounts, needsUkrainian, prose } from "../owner-language.mjs";

const SCRIPT = fileURLToPath(new URL("../owner-language.mjs", import.meta.url));
const SETTINGS = fileURLToPath(new URL("../../../.claude/settings.json", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}.jsonl`, import.meta.url));
const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8", timeout: 10_000 });
const stop = (name, extra = {}) =>
  JSON.stringify({ hook_event_name: "Stop", session_id: "s", transcript_path: fixture(name), stop_hook_active: false, ...extra });

const passes = (input) => {
  const r = run(input);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
};
const blocks = (input) => {
  const r = run(input);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.deepEqual(JSON.parse(r.stdout), { decision: "block", reason: REASON });
};

describe("owner-language Stop hook", () => {
  it("lets a Ukrainian message to the owner through (earlier English text in the turn does not count)", () => {
    passes(stop("lead-uk"));
  });

  it("blocks an English message to the owner with the Ukrainian reason", () => {
    blocks(stop("lead-en"));
    assert.match(REASON, /українською/);
  });

  it("joins the text blocks of the last message when the transcript splits it over several lines", () => {
    blocks(stop("lead-en-split"));
  });

  it("a Ukrainian message with code, a fenced block, paths, a SHA, a URL, a table and an @-mention passes", () => {
    passes(stop("lead-mixed"));
  });

  it("«Нічого нового для вас.» passes (too short to judge and Cyrillic anyway)", () => {
    passes(stop("lead-nothing-new"));
  });

  it("a turn that ends without text passes", () => {
    passes(stop("lead-no-text"));
  });

  it("the /pr-pipeline command also marks the lead session", () => {
    blocks(stop("lead-command-en"));
  });

  it("a session that never loaded pr-pipeline is not checked", () => {
    passes(stop("other-en"));
  });

  it("stop_hook_active true passes at once (no loop)", () => {
    passes(stop("lead-en", { stop_hook_active: true }));
  });

  it("malformed input passes: empty, not JSON, null, no transcript_path, a missing file", () => {
    for (const input of ["", "not json", "null", "[]", "{}", JSON.stringify({ transcript_path: 7 })]) passes(input);
    passes(JSON.stringify({ transcript_path: fixture("does-not-exist") }));
    assert.equal(hookOutput("{}", () => { throw new Error("boom"); }), "");
    assert.equal(hookOutput(JSON.stringify({ transcript_path: "x" }), () => { throw new Error("boom"); }), "");
  });

  it("broken transcript lines are skipped; the valid lines still decide", () => {
    blocks(stop("lead-broken"));
  });

  it("prose() drops code, URLs, paths, SHAs, ids and mentions", () => {
    const left = prose(
      "`pnpm typecheck` ```js\nconst x = 1;\n``` https://example.com/a/b tools/lead-hooks/owner-language.mjs " +
        "settings.json f344289a0c1d @reviewer session_01Si6vs2 PRC-02 claude/adoring-cray-feh4dh-langhook",
    );
    assert.equal(letterCounts(left).latin, 0, left);
  });

  it("short English text below the threshold passes; long English text blocks", () => {
    assert.equal(needsUkrainian("Merged #741."), false);
    assert.equal(needsUkrainian("Merged #741. The checks are green and the next PR is in review now."), true);
    assert.equal(needsUkrainian("Злито #741. Перевірки зелені, наступний PR на рецензії (review-pr, CI green)."), false);
  });

  it("runs fast: the largest fixture in well under a second", () => {
    const t = Date.now();
    passes(stop("lead-mixed"));
    assert.ok(Date.now() - t < 2000);
  });

  it(".claude/settings.json runs this script as the only Stop hook, timeout 10", () => {
    const settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
    const groups = settings.hooks.Stop;
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, undefined);
    assert.deepEqual(groups[0].hooks, [
      { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/tools/lead-hooks/owner-language.mjs"', timeout: 10 },
    ]);
  });
});
