#!/usr/bin/env node
// Створено: 2026-11-15 · Оновлено: 2026-11-15
// SessionStart hook, matcher `compact` (.claude/settings.json): after an automatic context compaction it reminds the
// agent how the Willowsum lead resumes (owner, 2026-11-15, #178 comment 6897443899). It only prints text: no network,
// no files, no secrets. Any other agent reads the reminder and ignores it. Test: node --test tools/lead-hooks
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const AFTER_COMPACT = [
  "Context was compacted.",
  "If you are the Willowsum lead (session title «Willowsum · ведучий N · …»): re-read issue #179 «Lead state»,",
  "re-invoke the `pr-pipeline` skill, then follow .claude/skills/pr-pipeline/references/restarts.md «After compaction»",
  "(you are now lead N+1 in this same session).",
  "Any other agent: ignore this note and continue your task.",
].join(" ");

/**
 * The hook's stdout for a SessionStart input (JSON text from stdin), or "" when nothing is to be added.
 * Unreadable or empty input still counts as a compaction: the matcher `compact` already filtered the event.
 */
export function hookOutput(inputText) {
  let source = "compact";
  try {
    const input = JSON.parse(inputText || "{}");
    if (input && typeof input.source === "string") source = input.source;
  } catch {
    // keep the default
  }
  if (source !== "compact") return "";
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: AFTER_COMPACT } });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let input = "";
  try {
    input = readFileSync(0, "utf8");
  } catch {
    // no stdin
  }
  const out = hookOutput(input);
  if (out) process.stdout.write(out + "\n");
}
