// CICD-01 FR 2 (ADR-0008): the PR title starts with the ID of an existing requirement, and the description
// follows .github/pull_request_template.md: it says which requirement, which criteria are covered by which
// tests, how it was tested, and whether sensitive areas are touched.
import fs from 'node:fs';
import path from 'node:path';

/**
 * A requirement ID at the start of the title, optionally as a release slice (`BUD-16@PoC`), followed by `:`, `,`,
 * a space or `(` (e.g. `DS-01 (#32): …`, `BUD-16@PoC: …`). The ID part must have a file in docs/requirements.
 */
const TITLE_ID = /^([A-Z][A-Z0-9]*-\d{2}[a-z]?)(?:@[A-Za-z0-9][A-Za-z0-9.-]*)?(?=[:,\s(])/;
const ID_FILE = /^([A-Z][A-Z0-9]*-\d{2}[a-z]?)\.md$/;

/** Every requirement ID that has a file in docs/requirements/<module>/ (cards and old one-file requirements). */
export function requirementIds(requirementsDir) {
  const ids = new Set();
  for (const entry of fs.readdirSync(requirementsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of fs.readdirSync(path.join(requirementsDir, entry.name))) {
      const m = ID_FILE.exec(name);
      if (m) ids.add(m[1]);
    }
  }
  return ids;
}

/** Sections the description must have, in the template's words. */
export const REQUIRED_SECTIONS = ['Requirement', 'Acceptance criteria covered', 'How it was tested', 'Sensitive areas touched'];

/** Split a Markdown body into `## ` sections: heading → text (HTML comments removed). */
export function sections(body) {
  const text = (body ?? '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const out = new Map();
  let current = null;
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      current = h[1].trim();
      if (!out.has(current)) out.set(current, '');
      continue;
    }
    if (current !== null) out.set(current, `${out.get(current)}${line}\n`);
  }
  return out;
}

const tableRows = (text) => text.split('\n').filter((l) => /^\s*\|.*\|\s*$/.test(l));
const isSeparator = (row) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(row);
const unticked = (line) => /^\s*[-*]\s+\[ \]/.test(line);
const ticked = (line) => /^\s*[-*]\s+\[[xX]\]/.test(line);

/**
 * Check a PR's title and body.
 * @param {{ title: string, body: string, ids: Set<string>, sensitive?: { sensitive: boolean, categories: string[] } }} pr
 * @returns {string[]} problems; empty when the description is fine
 */
export function checkDescription({ title, body, ids, sensitive }) {
  const problems = [];
  const m = TITLE_ID.exec(title ?? '');
  if (!m) {
    problems.push('The title must start with a requirement ID followed by «:», e.g. «BUD-03: safe-to-spend widget».');
  } else if (!ids.has(m[1])) {
    problems.push(`The title starts with ${m[1]}, but docs/requirements/ has no file for it.`);
  }

  const secs = sections(body);
  for (const name of REQUIRED_SECTIONS) {
    if (!secs.has(name)) problems.push(`The description has no «## ${name}» section (see .github/pull_request_template.md).`);
  }

  const requirement = (secs.get('Requirement') ?? '').trim();
  if (secs.has('Requirement') && !requirement) {
    problems.push('«Requirement» is empty: link the requirement file (for a migrated requirement, the release view).');
  }

  if (secs.has('Acceptance criteria covered')) {
    const text = secs.get('Acceptance criteria covered');
    const rows = tableRows(text);
    const dataRows = rows.slice(1).filter((r) => !isSeparator(r) && r.replace(/[|\s-]/g, '') !== '');
    if (!text.trim()) {
      problems.push('«Acceptance criteria covered» is empty: map each criterion to the test that covers it.');
    } else if (rows.length > 0 && dataRows.length === 0) {
      problems.push('«Acceptance criteria covered» has a table without rows: add one row per criterion → test.');
    }
  }

  if (secs.has('How it was tested')) {
    const lines = secs
      .get('How it was tested')
      .split('\n')
      .filter((l) => l.trim());
    if (lines.length === 0 || lines.every(unticked)) {
      problems.push('«How it was tested» is empty or has only unticked template items: say what was run.');
    }
  }

  if (sensitive?.sensitive && secs.has('Sensitive areas touched')) {
    const lines = secs.get('Sensitive areas touched').split('\n');
    if (!lines.some(ticked)) {
      problems.push(
        `The PR changes sensitive files (${sensitive.categories.join(', ')}): tick «Sensitive areas touched» — it needs a security review.`,
      );
    }
  }
  return problems;
}
