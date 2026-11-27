#!/usr/bin/env node
// Створено: 2026-11-27 · Оновлено: 2026-11-27
// Stop hook (.claude/settings.json): in the Willowsum lead's session it blocks the end of a turn whose last message to
// the owner is mostly Latin letters, so the lead rewrites it in Ukrainian (owner rule: SKILL.md «Мовчання в чаті»;
// decision log 2026-11-27-owner-language-hook.md). Only the lead's Claude Code session runs it, never the product.
// Lead session = the transcript shows the `pr-pipeline` skill loaded (a Skill tool call or the /pr-pipeline command).
// Subagents end with SubagentStop, not Stop, so they are not affected. It reads the transcript file only: no network,
// no dependencies. Any error → exit 0 with no output (never break the session). Test: node --test tools/lead-hooks
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REASON =
  "Повідомлення власнику має бути українською: перепиши його українською (код, шляхи й назви лишай як є).";
export const MIN_LETTERS = 40;

const entries = (jsonl) =>
  String(jsonl)
    .split("\n")
    .map((line) => {
      try {
        return line.trim() ? JSON.parse(line) : null;
      } catch {
        return null;
      }
    })
    .filter((e) => e && typeof e === "object");

const blocks = (entry) => {
  const content = entry?.message?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.filter((b) => b && typeof b === "object") : [];
};

const isPipelineSkill = (name) => name === "pr-pipeline" || String(name).endsWith(":pr-pipeline");

/** Whether the transcript belongs to the lead: the `pr-pipeline` skill was loaded. */
export function isLeadSession(list) {
  for (const e of list) {
    for (const b of blocks(e)) {
      if (e.type === "assistant" && b.type === "tool_use" && b.name === "Skill" && isPipelineSkill(b.input?.skill)) {
        return true;
      }
      if (e.type === "user" && b.type === "text" && /<command-name>\/?(?:[\w-]+:)?pr-pipeline<\/command-name>/.test(b.text)) {
        return true;
      }
    }
  }
  return false;
}

/** The text blocks of the last assistant message (all transcript lines with its message id), joined. */
export function lastAssistantText(list) {
  const assistant = list.filter((e) => e.type === "assistant" && e.message);
  if (assistant.length === 0) return "";
  const last = assistant[assistant.length - 1];
  const id = last.message.id;
  const same = id ? assistant.filter((e) => e.message.id === id) : [last];
  return same
    .flatMap(blocks)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** The prose left after removing code, links, paths, ids and mentions. */
export function prose(text) {
  return String(text)
    .replace(/```[\s\S]*?(```|$)/g, " ") // fenced code (an unclosed fence runs to the end)
    .replace(/~~~[\s\S]*?(~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ") // inline code, table code cells included
    .replace(/\b(?:https?|ftp):\/\/\S+/gi, " ") // URLs
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/<[^>\s]+>/g, " ") // <tags> and <autolinks>
    .replace(/@[\w.-]+(?:\/[\w.-]+)?/g, " ") // @-mentions, @scope/package
    .replace(/(?:[~.]{0,2}\/)?[\w.@-]+(?:\/[\w.@*-]+)+\/?/g, " ") // paths with a slash
    .replace(/\b[\w-]+\.(?:mjs|cjs|js|ts|tsx|jsx|json|jsonl|md|ya?ml|sql|sh|css|html|txt|toml|lock)\b/gi, " ") // file names
    .replace(/\b[0-9a-f]{7,64}\b/gi, " ") // SHAs and hex ids
    .replace(/\b[A-Za-z]+[_-]?\d[\w-]*\b/g, " ") // ids with digits: session_01…, PRC-02, ARC-07, v2
    .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/gi, " "); // snake_case identifiers
}

/** Latin and Cyrillic letter counts of a text. */
export function letterCounts(text) {
  const latin = (text.match(/[A-Za-zÀ-ɏ]/g) || []).length;
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) || []).length;
  return { latin, cyrillic };
}

/** Whether the message must be rewritten in Ukrainian. */
export function needsUkrainian(text) {
  const { latin, cyrillic } = letterCounts(prose(text));
  return latin + cyrillic >= MIN_LETTERS && latin > cyrillic;
}

/** The hook's stdout for a Stop input (JSON text from stdin), or "" to let the turn end. */
export function hookOutput(inputText, readFile = (p) => readFileSync(p, "utf8")) {
  try {
    const input = JSON.parse(inputText || "{}");
    if (!input || typeof input !== "object" || input.stop_hook_active === true) return "";
    if (typeof input.transcript_path !== "string" || !input.transcript_path) return "";
    const list = entries(readFile(input.transcript_path));
    if (!isLeadSession(list)) return "";
    const text = lastAssistantText(list);
    if (!text.trim() || !needsUkrainian(text)) return "";
    return JSON.stringify({ decision: "block", reason: REASON });
  } catch {
    return "";
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const out = hookOutput(readFileSync(0, "utf8"));
    if (out) process.stdout.write(out + "\n");
  } catch {
    // never break the session
  }
  process.exit(0);
}
