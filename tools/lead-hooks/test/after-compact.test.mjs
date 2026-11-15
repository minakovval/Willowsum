// Створено: 2026-11-15 · Оновлено: 2026-11-15
// The lead's SessionStart hook after compaction (owner, 2026-11-15, #178 comment 6897443899). No network.
// Run: node --test tools/lead-hooks
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AFTER_COMPACT, hookOutput } from "../after-compact.mjs";

const SCRIPT = fileURLToPath(new URL("../after-compact.mjs", import.meta.url));
const SETTINGS = fileURLToPath(new URL("../../../.claude/settings.json", import.meta.url));
const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8" });

describe("after-compact hook", () => {
  it("prints the SessionStart additionalContext JSON after a compaction", () => {
    const r = run(JSON.stringify({ hook_event_name: "SessionStart", source: "compact", session_id: "s" }));
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    const out = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(out), ["hookSpecificOutput"]);
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    assert.equal(out.hookSpecificOutput.additionalContext, AFTER_COMPACT);
  });

  it("names #179, the pr-pipeline skill and restarts.md «After compaction», and stays short", () => {
    for (const s of ["#179", "Lead state", "pr-pipeline", "restarts.md", "After compaction", "ignore"]) {
      assert.ok(AFTER_COMPACT.includes(s), s);
    }
    assert.ok(AFTER_COMPACT.length < 1000, "far below the 10 000-character hook limit");
  });

  it("the restarts.md section it points to exists", () => {
    const restarts = readFileSync(
      fileURLToPath(new URL("../../../.claude/skills/pr-pipeline/references/restarts.md", import.meta.url)),
      "utf8",
    );
    assert.match(restarts, /\*\*After compaction\*\*/);
  });

  it("adds nothing for any other SessionStart source", () => {
    for (const source of ["startup", "resume", "clear", "fork"]) {
      assert.equal(hookOutput(JSON.stringify({ source })), "");
      const r = run(JSON.stringify({ source }));
      assert.equal(r.status, 0);
      assert.equal(r.stdout, "");
    }
  });

  it("empty or broken input still exits 0 with the note (the matcher already chose compaction)", () => {
    for (const input of ["", "not json", "null"]) {
      const r = run(input);
      assert.equal(r.status, 0);
      assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, AFTER_COMPACT);
    }
  });

  it(".claude/settings.json runs this script on SessionStart with the matcher `compact` only", () => {
    const settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
    assert.deepEqual(Object.keys(settings), ["hooks"]);
    assert.deepEqual(Object.keys(settings.hooks), ["SessionStart"]);
    const groups = settings.hooks.SessionStart;
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, "compact");
    assert.deepEqual(groups[0].hooks, [
      { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/tools/lead-hooks/after-compact.mjs"', timeout: 10 },
    ]);
  });
});
