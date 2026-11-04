// Traceability model: requirements (cards or not-yet-migrated files) and their release slices.
// Pure data, no findings: checks/links.mjs validates it, traceability.mjs renders it.
import { ID_FILE_RE, SECTION, releaseIndex } from './config.mjs';
import { parseHeading, findSection, numberedItems } from './markdown.mjs';
import { parseReleaseLine } from './release.mjs';
import { parseLinkBlock, field, releasesOf, earliest } from './links.mjs';
import { parseGeneralRules, parseModuleCatalogue } from './registries.mjs';

/** Link field name → slice property. */
export const FIELD_KEY = {
  Розширює: 'extends',
  'Залежить від': 'depends',
  Дизайн: 'design',
  'Спільні правила': 'shared',
  Сценарії: 'useCases',
  Модуль: 'modules',
  Перевіряється: 'tests',
};

const emptyLinks = () => ({ extends: [], depends: [], design: [], shared: [], useCases: [], modules: [], tests: [] });

/**
 * @typedef {object} Slice
 * @property {string} sid        `BUD-16@PoC`
 * @property {string} id         requirement ID
 * @property {string} release
 * @property {boolean} explicit  true for a slice file, false for the implicit slice of a non-migrated file
 * @property {import('./corpus.mjs').Doc} doc   the slice file, or the requirement file for an implicit slice
 * @property {ReturnType<typeof emptyLinks>} links
 * @property {number} criteria   numbered acceptance criteria in the file
 * @property {object} feature
 */

/** Numbered criteria in the «Критерії приймання» section. */
export function countCriteria(lines) {
  const sec = findSection(lines, SECTION.criteria);
  return sec ? numberedItems(sec.lines).length : 0;
}

/** @param {ReturnType<import('./corpus.mjs').buildCorpus>} corpus */
export function buildModel(corpus) {
  const general = corpus.docs.find((d) => d.kind === 'general');
  const rules = general ? parseGeneralRules(general.lines) : new Set();
  const modules = new Set();
  for (const d of corpus.docs.filter((x) => x.id === 'ARC-01')) for (const m of parseModuleCatalogue(d.lines)) modules.add(m);

  /** @type {Map<string, any>} */
  const features = new Map();
  for (const d of corpus.docs) {
    if (d.kind !== 'requirement' || !d.id || !ID_FILE_RE.test(d.name) || features.has(d.id)) continue;
    const rl = parseReleaseLine(d.lines);
    const block = parseLinkBlock(d.lines);
    const { releases, foundation } = releasesOf(rl?.releaseText);
    features.set(d.id, {
      id: d.id,
      folder: d.folder,
      area: d.id.split('-')[0],
      doc: d,
      title: parseHeading(d.lines[0])?.title ?? '',
      releaseLine: rl,
      releases,
      foundation,
      firstRelease: earliest([...releases, ...(foundation ? [foundation] : [])]),
      block,
      card: Boolean(block && field(block, 'Зрізи')),
      modules: block ? field(block, 'Модуль')?.values ?? [] : [],
      sliceDocs: [],
      slices: [],
    });
  }

  const orphans = [];
  for (const d of corpus.docs.filter((x) => x.kind === 'slice')) {
    const f = features.get(d.id);
    if (f?.card) f.sliceDocs.push(d);
    else orphans.push(d);
  }

  /** @type {Map<string, Slice>} */
  const slices = new Map();
  for (const f of features.values()) {
    if (f.card) {
      f.sliceDocs.sort((a, b) => releaseIndex(a.release) - releaseIndex(b.release));
      for (const d of f.sliceDocs) {
        const block = parseLinkBlock(d.lines);
        const links = emptyLinks();
        for (const fl of block?.fields ?? []) if (FIELD_KEY[fl.name]) links[FIELD_KEY[fl.name]] = fl.values;
        const s = { sid: `${f.id}@${d.release}`, id: f.id, release: d.release, explicit: true, doc: d, block, links, criteria: countCriteria(d.lines), feature: f };
        f.slices.push(s);
        if (!slices.has(s.sid)) slices.set(s.sid, s);
      }
    } else {
      const criteria = countCriteria(f.doc.lines);
      for (const r of f.releases) {
        const s = { sid: `${f.id}@${r}`, id: f.id, release: r, explicit: false, doc: f.doc, block: null, links: emptyLinks(), criteria, feature: f };
        f.slices.push(s);
        slices.set(s.sid, s);
      }
    }
  }
  return { features, slices, orphans, rules, modules };
}
