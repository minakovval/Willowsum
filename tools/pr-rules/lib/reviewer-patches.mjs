// Owner decision 2026-11-19 (log: docs/decisions/log/2026-11-19-owner-reviewer-patch-paths.md): what a reviewer
// patch must not touch or add. The rule text is `review-pr` §7; this helper checks what can be checked from the
// files and the unified diff of the reviewer's commit.
import { categoriesOf } from './paths.mjs';

const SECURITY_TEST = /(^|\/)(isolation|privacy|rls|crypto|vault|authz|permissions?|sec\d+[a-z0-9]*-)[^/]*\.(it\.)?test\.[cm]?[jt]sx?$/;
const RULE_FILE = /^(AGENTS\.md|CLAUDE\.md|\.claude\/.*)$/;
const DISABLED_TEST = /\b(?:it|test|describe)\s*\.\s*(?:skip|only|todo|fails)\b|\bx(?:it|describe)\s*\(/;
const DIRECTIVE = /eslint-(?:disable|enable)|@ts-(?:ignore|expect-error|nocheck)|gitleaks:allow|prettier-ignore/;
const REMOVED_TEST = /^\s*(?:it|test)(?:\.\w+)?\s*\(/;

/** Why a path is closed to reviewer patches, or `null`. */
export function forbiddenPathReason(path) {
  if (categoriesOf(path).length > 0) return 'sensitive path';
  if (SECURITY_TEST.test(path)) return 'security test';
  if (RULE_FILE.test(path)) return 'rule file';
  return null;
}

/** Violations of `review-pr` §7 in a reviewer commit: `files` = [{ filename, previous_filename? }], `diff` = unified diff. */
export function reviewerPatchViolations(files, diff = '') {
  const out = [];
  for (const f of files) {
    for (const p of [f.filename, f.previous_filename].filter(Boolean)) {
      const why = forbiddenPathReason(p);
      if (why) out.push(`${p}: ${why}`);
    }
  }
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    const body = line.slice(1);
    if (line.startsWith('+') && DISABLED_TEST.test(body)) out.push(`added skip/only/todo: ${body.trim()}`);
    if (line.startsWith('+') && DIRECTIVE.test(body)) out.push(`added directive comment: ${body.trim()}`);
    if (line.startsWith('-') && REMOVED_TEST.test(body)) out.push(`removed or changed test: ${body.trim()}`);
  }
  return out;
}
