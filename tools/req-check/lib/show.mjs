// --show <ID@release>: one slice at a glance — its view, what it depends on, the decisions that cite it and its
// coverage line (owner, 2026-11-13: agents read this instead of whole folders). No I/O: the caller passes the
// decision files and the coverage.
import { releaseIndex } from './config.mjs';

const ID_RE = /^([A-Z][A-Z0-9]*-\d{2}[a-z]?)(?:@(.+))?$/;

/**
 * Resolve a target to a slice: `ID@release` exactly, else the latest slice of that ID at or before the release
 * (a view is complete for every release up to the next one); a plain ID gives its first slice.
 * @returns {{slice: object, note: string|null}|null}
 */
export function resolveSlice(model, target) {
  const m = ID_RE.exec(String(target).trim());
  if (!m) return null;
  const f = model.features.get(m[1]);
  if (!f || !f.slices.length) return null;
  if (!m[2]) return { slice: f.slices[0], note: `no release given: the first slice, ${f.slices[0].sid}` };
  const exact = f.slices.find((s) => s.release === m[2]);
  if (exact) return { slice: exact, note: null };
  const want = releaseIndex(m[2]);
  if (want < 0) return null;
  const earlier = f.slices.filter((s) => releaseIndex(s.release) <= want).pop();
  if (!earlier) return null;
  return { slice: earlier, note: `${m[1]} has no ${m[2]} slice: the latest earlier one, ${earlier.sid}, applies` };
}

/** Lines of the decision files that name the requirement ID (`BUD-16`, `BUD-16@PoC`; not `BUD-16a`). */
export function decisionMentions(files, id, limit = 40) {
  const re = new RegExp(`(?<![A-Za-z0-9-])${id.replace(/[-]/g, '\\-')}(?![0-9A-Za-z])`);
  const out = [];
  for (const { rel, text } of files) {
    text.split('\n').forEach((line, i) => {
      if (out.length < limit && re.test(line)) out.push({ file: rel, line: i + 1, text: line.trim().slice(0, 200) });
    });
  }
  return out;
}

/**
 * Markdown for one slice.
 * @param {object} model buildModel output
 * @param {object} slice resolved slice
 * @param {{note?: string|null, decisions: ReturnType<typeof decisionMentions>, coverageRow?: object, viewText: string}} extra
 */
export function renderShow(model, slice, { note = null, decisions, coverageRow, viewText }) {
  const L = [`# ${slice.sid} — ${slice.doc.rel}`, ''];
  if (note) L.push(`Note: ${note}.`, '');
  if (!slice.explicit) L.push('Not migrated yet: this is the whole requirement file, without a link header.', '');
  L.push(viewText.trimEnd(), '', '---', '');
  const describe = (sid) => {
    const s = model.slices.get(sid);
    return s ? `${sid} — ${s.doc.rel} — ${s.feature.title}` : `${sid} — (no such slice)`;
  };
  L.push('## Dependencies', '');
  const direct = [...slice.links.extends.map((x) => ['extends', x]), ...slice.links.depends.map((x) => ['depends on', x])].filter(([, x]) => x !== '—');
  if (!direct.length) L.push('None.');
  for (const [kind, sid] of direct) L.push(`- ${kind}: ${describe(sid)}`);
  // Transitive dependencies, one line: everything the direct ones depend on in turn.
  const seen = new Set(direct.map(([, x]) => x));
  const queue = [...seen];
  const further = [];
  while (queue.length) {
    const s = model.slices.get(queue.shift());
    if (!s) continue;
    for (const x of [...s.links.extends, ...s.links.depends]) {
      if (x === '—' || seen.has(x) || x === slice.sid) continue;
      seen.add(x);
      further.push(x);
      queue.push(x);
    }
  }
  if (further.length) L.push('', `Further (transitive): ${further.sort().join(', ')}`);
  const dependents = [...model.slices.values()].filter((s) => s.links.depends.includes(slice.sid) || s.links.extends.includes(slice.sid)).map((s) => s.sid).sort();
  L.push('', `Depended on by: ${dependents.length ? dependents.join(', ') : 'none'}`, '');
  L.push('## Decisions that cite it', '');
  L.push(decisions.length ? decisions.map((d) => `- ${d.file}:${d.line} — ${d.text}`).join('\n') : 'None in docs/decisions/.', '');
  L.push('## Coverage', '');
  if (!coverageRow) L.push('No items to cover (not migrated, or no numbered items).');
  else {
    const c = (k) => `${coverageRow[k].covered}/${coverageRow[k].total}`;
    const missing = [...coverageRow.FR.missing, ...coverageRow.AC.missing, ...coverageRow.EC.missing];
    L.push(`| Slice | FR | AC | EC | Not covered |`, '| --- | ---: | ---: | ---: | --- |', `| ${slice.sid} | ${c('FR')} | ${c('AC')} | ${c('EC')} | ${missing.join(', ') || '—'} |`);
  }
  L.push('');
  return L.join('\n');
}
