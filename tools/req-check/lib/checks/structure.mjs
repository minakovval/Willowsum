// Check 1: file name = ID, heading `# <ID> · <title>`, unique IDs, READMEs list exactly the files present.
import { ID_FILE_RE } from '../config.mjs';
import { parseHeading } from '../markdown.mjs';
import { parseModuleReadme, parseIndexReadme, parseReleaseMix } from '../readme.mjs';
import { parseReleaseLine } from '../release.mjs';

const CHECK = 'structure';

/**
 * @param {ReturnType<import('../corpus.mjs').buildCorpus>} corpus
 * @param {import('../findings.mjs').Findings} out
 * @returns {{readmeRows: Map<string, ReturnType<typeof parseModuleReadme>[number]>}}
 */
export function checkStructure(corpus, out) {
  const reqs = corpus.docs.filter((d) => d.kind === 'requirement');
  for (const d of corpus.docs.filter((x) => x.kind === 'other')) {
    out.add({
      check: CHECK,
      rule: 'unexpected-file',
      file: d.rel,
      message: `"${d.rel}" is not a requirement file (<module>/<ID>.md, e.g. bud/BUD-03.md), a module README, 00-general.md or README.md`,
    });
  }

  // File names, headings, folder.
  const byId = new Map();
  for (const d of reqs) {
    if (!ID_FILE_RE.test(d.name)) {
      out.add({ check: CHECK, rule: 'file-name', file: d.rel, message: `file name "${d.name}" is not a requirement ID (e.g. BUD-03.md, AST-14a.md)` });
      continue;
    }
    const prefix = d.id.split('-')[0].toLowerCase();
    if (prefix !== d.folder) {
      out.add({ check: CHECK, rule: 'file-folder', file: d.rel, message: `${d.id} is in folder "${d.folder}/", expected "${prefix}/"` });
    }
    const h = parseHeading(d.lines[0]);
    if (!h) {
      out.add({ check: CHECK, rule: 'heading', file: d.rel, line: 1, message: `first line must be "# ${d.id} · <title>", found "${(d.lines[0] ?? '').slice(0, 80)}"` });
    } else if (h.id !== d.id) {
      out.add({ check: CHECK, rule: 'heading', file: d.rel, line: 1, message: `heading ID "${h.id}" does not match file name ${d.id}` });
    }
    if (!byId.has(d.id)) byId.set(d.id, []);
    byId.get(d.id).push(d);
  }
  for (const [id, docs] of byId) {
    if (docs.length > 1) {
      for (const d of docs) {
        out.add({ check: CHECK, rule: 'duplicate-id', file: d.rel, key: id, message: `ID ${id} is used by ${docs.length} files: ${docs.map((x) => x.rel).join(', ')}` });
      }
    }
  }

  // Module READMEs.
  const readmeRows = new Map();
  for (const folder of corpus.folders) {
    const readme = corpus.docs.find((d) => d.kind === 'readme' && d.folder === folder);
    const present = reqs.filter((d) => d.folder === folder);
    if (!readme) {
      out.add({ check: CHECK, rule: 'readme-absent', file: `${corpus.prefix}/${folder}/README.md`, message: `module folder "${folder}/" has no README.md` });
      continue;
    }
    const rows = parseModuleReadme(readme.lines);
    const listed = new Map();
    for (const r of rows) {
      if (listed.has(r.id)) {
        out.add({ check: CHECK, rule: 'readme-duplicate', file: readme.rel, line: r.index + 1, key: r.id, message: `${r.id} is listed more than once` });
        continue;
      }
      listed.set(r.id, r);
      readmeRows.set(`${folder}/${r.id}`, r);
      if (r.target !== `${r.id}.md`) {
        out.add({ check: CHECK, rule: 'readme-link', file: readme.rel, line: r.index + 1, key: r.id, message: `row ${r.id} links to "${r.target}", expected "${r.id}.md"` });
      }
    }
    for (const d of present) {
      const r = listed.get(d.id);
      if (!r) {
        out.add({ check: CHECK, rule: 'readme-missing', file: readme.rel, key: d.id, message: `${d.id} exists (${d.rel}) but is not listed in the README` });
        continue;
      }
      const h = parseHeading(d.lines[0]);
      if (h && h.title !== r.title) {
        out.add({ check: CHECK, rule: 'readme-title', severity: 'warning', file: readme.rel, line: r.index + 1, key: d.id, message: `${d.id} title differs: README "${r.title}" vs file "${h.title}"` });
      }
      const rel = parseReleaseLine(d.lines);
      const fileRelease = rel?.releaseText ?? '';
      const filePriority = rel?.priorityText ?? '';
      if (fileRelease !== r.release || filePriority !== r.priority) {
        out.add({ check: CHECK, rule: 'readme-release', severity: 'warning', file: readme.rel, line: r.index + 1, key: d.id, message: `${d.id} release/priority differs: README "${r.release} | ${r.priority}" vs file "${fileRelease} | ${filePriority}"` });
      }
    }
    const presentIds = new Set(present.map((d) => d.id));
    for (const r of listed.values()) {
      if (!presentIds.has(r.id)) {
        out.add({ check: CHECK, rule: 'readme-extra', file: readme.rel, line: r.index + 1, key: r.id, message: `${r.id} is listed but ${folder}/${r.id}.md does not exist` });
      }
    }
  }

  // Top-level index README: one row per module folder, with the right count and release mix.
  const index = corpus.docs.find((d) => d.kind === 'index');
  if (index) {
    const rows = parseIndexReadme(index.lines);
    const listedFolders = new Set(rows.map((r) => r.folder));
    for (const folder of corpus.folders) {
      if (!listedFolders.has(folder)) {
        out.add({ check: CHECK, rule: 'index-missing', file: index.rel, key: folder, message: `module folder "${folder}/" is not listed in the module table` });
      }
    }
    for (const r of rows) {
      const present = reqs.filter((d) => d.folder === r.folder);
      if (!corpus.folders.includes(r.folder)) {
        out.add({ check: CHECK, rule: 'index-extra', file: index.rel, line: r.index + 1, key: r.folder, message: `module "${r.folder}/" is listed but the folder does not exist` });
        continue;
      }
      if (r.count !== present.length) {
        out.add({ check: CHECK, rule: 'index-count', file: index.rel, line: r.index + 1, key: r.folder, message: `module ${r.code} lists ${r.count} requirements, folder has ${present.length}` });
      }
      const mix = new Map();
      for (const d of present) {
        const rl = parseReleaseLine(d.lines);
        const k = !rl ? 'n/a' : rl.release ?? 'other';
        mix.set(k, (mix.get(k) ?? 0) + 1);
      }
      const declared = parseReleaseMix(r.mix);
      const same = declared.size === mix.size && [...mix].every(([k, v]) => declared.get(k) === v);
      if (!same) {
        const actual = [...mix].map(([k, v]) => `${k} ${v}`).join(', ');
        out.add({ check: CHECK, rule: 'index-release-mix', severity: 'warning', file: index.rel, line: r.index + 1, key: r.folder, message: `module ${r.code} release mix "${r.mix}" differs from files "${actual}"` });
      }
    }
    const m = index.lines.map((l, i) => [/^## Modules \((\d+) requirements\)/.exec(l), i]).find(([x]) => x);
    if (m && Number(m[0][1]) !== reqs.length) {
      out.add({ check: CHECK, rule: 'index-total', severity: 'warning', file: index.rel, line: m[1] + 1, message: `index says ${m[0][1]} requirements, folders contain ${reqs.length}` });
    }
  }

  return { readmeRows };
}
