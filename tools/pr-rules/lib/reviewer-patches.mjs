// Owner decision 2026-11-19 (log: docs/decisions/log/2026-11-19-owner-reviewer-patch-paths.md): what a reviewer
// patch must not touch or add. The rule text is `review-pr` §7; this helper checks what can be checked from the
// files and the unified diff of the reviewer's commit. It fails closed: what it cannot read is a violation.
import path from 'node:path';
import { categoriesOf } from './paths.mjs';

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?(?:\.snap)?$/;
// Lead decision 2026-11-19 (#595): the name starts with `isolation` or has a `security` / `sec<N>…` part.
const SECURITY_NAME = /^isolation|(?:^|[-._])(?:security|sec\d+[a-z0-9]*)[-._]/;
// Owner decision 2026-11-19, item 3а: security tests by content whose name has no such word, listed by name
// (each read and confirmed): the guards of the isolation event trigger, the telemetry redaction of personal data,
// and the leak-check helper with its guard. A new one is added here.
const SECURITY_BY_CONTENT = new Set([
  'guard.it.test.ts',
  'guard-coverage.it.test.ts',
  'guard-gates.it.test.ts',
  'leak-check-guard.test.ts',
  'leak-text.test.ts',
  'redaction.test.ts',
]);
const E2E = /^apps\/web\/e2e\//; // owner, item 1а: e2e tests stay open
// Any folder: Claude Code also loads a nested CLAUDE.md, CLAUDE.local.md and `.claude/`.
const RULE_FILE = /(?:^|\/)(?:agents|claude)(?:\.local)?\.md$|(?:^|\/)\.claude(?:\/|$)/;
const OFF = 'skip|only|todo|fails|fixme|skipIf|runIf';
const DISABLED_TEST = new RegExp(
  `(?:\\.\\s*|\\[\\s*['"\`])(?:${OFF})\\b|\\b(?:it|test|describe)\\s*\\.\\s*fail\\b|\\b[xf](?:it|test|describe)\\s*\\(`,
);
// security-review §0 «Light confirmation», the directive list.
const DIRECTIVE =
  /eslint-(?:disable|enable)|\/\*\s*(?:eslint|globals?)\s|@ts-(?:ignore|expect-error|nocheck)|@(?:vitest|jest)-environment|gitleaks:allow|prettier-ignore|(?:istanbul|c8|v8)\s+ignore/i;
const REMOVED_TEST = /^\s*(?:it|test|describe)\b[\w.\s]*[(`]/;
const REMOVED_ASSERTION = /\bexpect(?:\.\w+)*\s*\(|\bassert(?:\.\w+)*\s*\(/;
const FILE_HEADER = /^(?:diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |GIT binary patch)/;

/** The path as git stores it: no `./`, no `a/../`, `\` as `/`. */
const normalize = (p) => path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/^\.\//, '');

/** Why a path is closed to reviewer patches, or `null`. Names are compared without case (macOS, Windows checkouts). */
export function forbiddenPathReason(rawPath) {
  const p = normalize(rawPath);
  if (p === '..' || p.startsWith('../') || p.startsWith('/')) return 'path outside the repository';
  const lower = p.toLowerCase();
  if (categoriesOf(p).length > 0 || categoriesOf(lower).length > 0) return 'sensitive path';
  if (RULE_FILE.test(lower)) return 'rule file';
  const name = lower.slice(lower.lastIndexOf('/') + 1);
  if (TEST_FILE.test(name) && !E2E.test(lower) && (SECURITY_NAME.test(name) || SECURITY_BY_CONTENT.has(name.replace(/\.snap$/, '')))) {
    return 'security test';
  }
  return null;
}

/** Added and removed lines of a unified diff, by hunk line counts (a line of content can start with `++` or `--`). */
function changedLines(diff) {
  const lines = [];
  const unparsed = [];
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of String(diff).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (oldLeft <= 0 && newLeft <= 0) {
      const m = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      if (m) {
        oldLeft = m[1] === undefined ? 1 : Number(m[1]);
        newLeft = m[2] === undefined ? 1 : Number(m[2]);
      } else if (line !== '' && !line.startsWith('\\') && !FILE_HEADER.test(line)) unparsed.push(line);
      continue;
    }
    if (line.startsWith('\\')) continue;
    if (line.startsWith('+')) {
      newLeft -= 1;
      lines.push(['+', line.slice(1)]);
    } else if (line.startsWith('-')) {
      oldLeft -= 1;
      lines.push(['-', line.slice(1)]);
    } else {
      oldLeft -= 1;
      newLeft -= 1;
    }
  }
  return { lines, unparsed };
}

/**
 * Violations of `review-pr` §7 in a reviewer commit: `files` = [{ filename, previous_filename?, status? }],
 * `diff` = unified diff with its `@@` hunk headers (`git show`, or the `patch` fields of the API joined).
 */
export function reviewerPatchViolations(files, diff = '') {
  const out = [];
  for (const f of files) {
    for (const p of [f.filename, f.previous_filename].filter(Boolean)) {
      const why = forbiddenPathReason(p);
      if (why) out.push(`${p}: ${why}`);
    }
    if (f.status === 'removed' && TEST_FILE.test(String(f.filename).toLowerCase())) out.push(`removed test file: ${f.filename}`);
  }
  const { lines, unparsed } = changedLines(diff ?? '');
  if (unparsed.length > 0) out.push(`diff line outside a hunk, cannot check: ${unparsed[0].trim()}`);
  // A test call whose title changed (same line, another literal title without `${…}`) is a text patch, not a
  // removal. One added line pairs with one removed line.
  const TITLE = /^(\s*(?:it|test|describe)\b[\w.]*\s*\(\s*)(['"`])(?:\\.|(?!\2)[^$\\]|\$(?!\{))*\2/;
  const untitled = (b) => (TITLE.test(b) ? b.replace(TITLE, '$1""').trim() : null);
  const spare = new Map();
  for (const [sign, body] of lines) {
    const key = sign === '+' ? untitled(body) : null;
    if (key !== null) spare.set(key, (spare.get(key) ?? 0) + 1);
  }
  const retitled = (body) => {
    const key = untitled(body);
    if (key === null || !spare.get(key)) return false;
    spare.set(key, spare.get(key) - 1);
    return true;
  };
  for (const [sign, body] of lines) {
    if (sign === '-' && REMOVED_TEST.test(body) && retitled(body)) continue;
    if (sign === '+' && DISABLED_TEST.test(body)) out.push(`added skip/only/todo: ${body.trim()}`);
    if (sign === '+' && DIRECTIVE.test(body)) out.push(`added directive comment: ${body.trim()}`);
    if (sign === '-' && REMOVED_TEST.test(body)) out.push(`removed or changed test: ${body.trim()}`);
    else if (sign === '-' && REMOVED_ASSERTION.test(body)) out.push(`removed or changed assertion: ${body.trim()}`);
  }
  return out;
}
