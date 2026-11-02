// Baseline of known findings: errors listed here are reported as warnings so CI stays green,
// while any new error fails. The baseline should only shrink.
import fs from 'node:fs';

export function readBaseline(file) {
  if (!file || !fs.existsSync(file)) return { findings: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.findings)) throw new Error(`${file}: "findings" must be an array`);
  return data;
}

/**
 * Mark baselined findings and list stale baseline entries.
 * @param {import('./findings.mjs').Finding[]} findings
 * @param {{findings: {id: string}[]}} baseline
 */
export function applyBaseline(findings, baseline) {
  const ids = new Set(baseline.findings.map((f) => f.id));
  const matched = new Set();
  const result = findings.map((f) => {
    if (f.severity === 'error' && ids.has(f.id)) {
      matched.add(f.id);
      return { ...f, baselined: true };
    }
    return f;
  });
  const stale = [...ids].filter((id) => !matched.has(id)).sort();
  return { findings: result, stale };
}

/** Baseline document for the current errors. */
export function makeBaseline(findings) {
  const errors = findings.filter((f) => f.severity === 'error');
  return {
    $comment: [
      'Known requirement findings accepted when the checker was introduced. Each entry is reported as a warning;',
      'any error whose id is not listed fails CI. Remove an entry when its requirement file is fixed.',
      'Regenerate only by a reviewed change: node tools/req-check/index.mjs --update-baseline',
    ],
    findings: errors
      .map((f) => ({ id: f.id, file: f.file, line: f.line, message: f.message }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
