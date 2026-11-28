// --coverage: tests named by item («ACC-01 FR 12», «UX-09@PoC AC7», «BUD-16 EC2») mapped to the items of
// the release views, and coverage per release. An item of a source is one source line, so a test written
// against FR 3 of the PoC view also covers that item in every later view that keeps the line, whatever its
// number there.
import { SLICE_RELEASES, releaseIndex } from './config.mjs';
import { itemsOf } from './items.mjs';

const REQ_RE = /(?<![\p{L}\p{N}_-])([A-Z][A-Z0-9]{1,4}-\d{2}[a-z]?)(?:@(PoC v2|PoC|MVP|v1-mobile|v1|v2))?(?![A-Za-z0-9_])/gu;
const KIND = { FR: 'FR', AC: 'AC', EC: 'EC', item: 'FR', criterion: 'AC', acceptance: 'AC' };
const REF_RE = /\b(FR|AC|EC|item|criterion|acceptance)\s?(\d+)(?:\s?[–-]\s?(?:(?:FR|AC|EC)\s?)?(\d+))?/g;

/**
 * A line with this marker (in a comment) is not read for mentions: the requirements checker's own tests hold
 * fixture texts that name made-up items of a real ID («BUD-16 FR 9»), which are neither coverage nor errors.
 */
export const IGNORE_MENTION = 'req-check-ignore-mention';

/**
 * Mentions of items in the text of test files.
 * @param {{rel: string, text: string}[]} files
 * @returns {{file: string, line: number, id: string, release: string|null, kind: string, n: number}[]}
 */
export function findMentions(files) {
  const out = [];
  for (const { rel, text } of files) {
    // A release named once for a requirement anywhere in the file applies to its plain mentions.
    const fileRelease = new Map();
    const lines = text.split('\n').map((l) => (l.includes(IGNORE_MENTION) ? '' : l));
    for (const m of lines.join('\n').matchAll(REQ_RE)) {
      if (!m[2]) continue;
      const prev = fileRelease.get(m[1]);
      fileRelease.set(m[1], prev === undefined || prev === m[2] ? m[2] : null);
    }
    lines.forEach((line, i) => {
      const reqs = [...line.matchAll(REQ_RE)];
      reqs.forEach((m, k) => {
        const end = k + 1 < reqs.length ? reqs[k + 1].index : line.length;
        const tail = line.slice(m.index + m[0].length, end);
        for (const r of tail.matchAll(REF_RE)) {
          const kind = KIND[r[1]];
          const a = Number(r[2]);
          const b = r[3] ? Number(r[3]) : a;
          for (let n = a; n <= Math.min(b, a + 50); n++) out.push({ file: rel, line: i + 1, id: m[1], release: m[2] ?? fileRelease.get(m[1]) ?? null, kind, n });
        }
      });
    });
  }
  return out;
}

/** The coverage key of an item of an explicit slice: its source line for a generated view, else slice + item. */
export function itemCoverageKey(s, it) {
  const g = s.doc.generated;
  return g ? `${g.sourceRel}:${g.lineMap[it.index] + 1}` : `${s.sid}:${it.kind}${it.n}`;
}

/**
 * Map mentions to items and count coverage per release.
 * @param {ReturnType<import('./model.mjs').buildModel>} model
 * @param {ReturnType<typeof findMentions>} mentions
 */
export function computeCoverage(model, mentions) {
  // Items of every explicit slice; key = source line for a generated view, else slice + item.
  const sliceItems = new Map();
  for (const s of model.slices.values()) {
    if (!s.explicit) continue;
    sliceItems.set(
      s.sid,
      itemsOf(s.doc.lines).map((it) => ({ ...it, key: itemCoverageKey(s, it) })),
    );
  }
  const covered = new Map();
  const unresolved = [];
  for (const m of mentions) {
    const f = model.features.get(m.id);
    if (!f) continue;
    const explicit = f.slices.filter((s) => s.explicit);
    if (!explicit.length) continue;
    const want = m.release ?? explicit[0].release;
    const s = explicit.filter((x) => releaseIndex(x.release) <= releaseIndex(want)).pop() ?? explicit[0];
    const it = sliceItems.get(s.sid).find((x) => x.kind === m.kind && x.n === m.n);
    if (!it) {
      unresolved.push({ ...m, sid: s.sid });
      continue;
    }
    if (!covered.has(it.key)) covered.set(it.key, []);
    covered.get(it.key).push(`${m.file}:${m.line}`);
  }
  const rows = [];
  for (const [sid, items] of sliceItems) {
    const s = model.slices.get(sid);
    const count = (kind) => {
      const xs = items.filter((x) => x.kind === kind);
      return { total: xs.length, covered: xs.filter((x) => covered.has(x.key)).length, missing: xs.filter((x) => !covered.has(x.key)).map((x) => `${kind}${x.n}`) };
    };
    rows.push({ sid, id: s.id, release: s.release, FR: count('FR'), AC: count('AC'), EC: count('EC') });
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : releaseIndex(a.release) - releaseIndex(b.release)));
  return { rows, unresolved, covered, mentions: mentions.length, items: covered.size };
}

/**
 * Mentions in test files that name an item the requirement does not have (`CICD-06@PoC has no AC3`): a wrong
 * number makes coverage silently wrong, so `--check-mentions` (CI, job `requirements`) fails on any of them.
 * @param {ReturnType<typeof computeCoverage>} cov
 * @returns {{file: string, line: number, rule: string, message: string}[]} one per distinct file, line and item
 */
export function danglingMentions(cov) {
  const seen = new Set();
  const out = [];
  for (const m of cov.unresolved) {
    const message = `${m.sid} has no ${m.kind}${m.n}: name an item of that view («${m.id}@<release> FR 3», «AC 2», «EC 1»), or a table criterion by its words («criterion «…»»)`;
    const key = `${m.file}:${m.line}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: m.file, line: m.line, rule: 'mention-no-item', message });
  }
  return out;
}

/** Markdown report of the coverage. */
export function renderCoverage(cov) {
  const pct = (c, t) => (t ? `${Math.round((100 * c) / t)} %` : '—');
  const L = ['# Item coverage by tests', ''];
  L.push(`${cov.mentions} item mentions in test files, ${cov.items} distinct items covered. A test names an item as «<ID> FR 3», «<ID>@PoC AC7», «<ID> EC2» (also «item n» = FR, «criterion n» = AC); a plain ID means the release named for it elsewhere in the file, else its first slice.`, '');
  L.push('## Per release', '', '| Release | Slices | FR covered | AC covered | EC covered |', '| --- | ---: | ---: | ---: | ---: |');
  for (const r of SLICE_RELEASES) {
    const rs = cov.rows.filter((x) => x.release === r);
    if (!rs.length) continue;
    const sum = (k, f) => rs.reduce((a, x) => a + x[k][f], 0);
    L.push(`| ${r} | ${rs.length} | ${sum('FR', 'covered')} / ${sum('FR', 'total')} (${pct(sum('FR', 'covered'), sum('FR', 'total'))}) | ${sum('AC', 'covered')} / ${sum('AC', 'total')} (${pct(sum('AC', 'covered'), sum('AC', 'total'))}) | ${sum('EC', 'covered')} / ${sum('EC', 'total')} (${pct(sum('EC', 'covered'), sum('EC', 'total'))}) |`);
  }
  L.push('', '## Slices with tests', '', '| Slice | FR | AC | EC | Not covered |', '| --- | ---: | ---: | ---: | --- |');
  for (const x of cov.rows.filter((y) => y.FR.covered + y.AC.covered + y.EC.covered > 0)) {
    L.push(`| ${x.sid} | ${x.FR.covered}/${x.FR.total} | ${x.AC.covered}/${x.AC.total} | ${x.EC.covered}/${x.EC.total} | ${[...x.FR.missing, ...x.AC.missing, ...x.EC.missing].join(', ') || '—'} |`);
  }
  L.push('', `## Mentions that name no item (${cov.unresolved.length})`, '');
  L.push(cov.unresolved.length ? cov.unresolved.map((m) => `- ${m.file}:${m.line} — ${m.sid} has no ${m.kind}${m.n}`).join('\n') : 'None.');
  L.push('');
  return L.join('\n');
}

/**
 * Coverage per release as JSON for the progress dashboard (PRC-02, owner decision 2026-11-19): FR, AC and EC
 * covered / total per release, the time it was computed and the main commit it was computed on. The page shows
 * only these numbers; it never estimates one that is missing.
 * @param {ReturnType<typeof computeCoverage>} cov
 * @param {{sha?: string|null, generatedAt?: string, features?: {titles: Map<string, string>, fingerprintErrors: Map<string, number>, blocks?: object}}} [meta]
 *   features: the title of every requirement and the fingerprint errors per requirement ID; given, the JSON also
 *   lists the PoC features (version 2, `featuresSummary`)
 */
export function coverageSummary(cov, { sha = null, generatedAt = new Date().toISOString(), features = null } = {}) {
  const releases = [];
  for (const release of SLICE_RELEASES) {
    const rs = cov.rows.filter((x) => x.release === release);
    if (!rs.length) continue;
    const sum = (k) => ({ covered: rs.reduce((a, x) => a + x[k].covered, 0), total: rs.reduce((a, x) => a + x[k].total, 0) });
    const FR = sum('FR');
    const AC = sum('AC');
    const EC = sum('EC');
    releases.push({ release, slices: rs.length, FR, AC, EC, items: { covered: FR.covered + AC.covered + EC.covered, total: FR.total + AC.total + EC.total } });
  }
  // distinct: items named by tests in any release (the «distinct items covered» of --coverage); the progress page's
  // history adds one point of it per merge (tools/progress-dashboard/history.mjs).
  return { schema: 1, version: 2, generatedAt, sha, releases, distinct: { covered: cov.items, mentions: cov.mentions }, ...(features ? { blocks: (features.blocks?.blocks ?? []).map((b) => ({ id: b.id, name: b.name, note: b.note })), features: featuresSummary(cov, features) } : {}) };
}

/** Ukrainian names of the requirement sections (ID prefix = folder of docs/requirements). An unknown prefix shows as itself. */
export const SECTION_NAMES = {
  ACC: 'Рахунки', ADM: 'Адмін-панель', ADV: 'Поради та аналітика', AI: 'ШІ-помічник', ARC: 'Архітектура', AST: 'Активи', BUD: 'Бюджет',
  CHT: 'Графіки', CICD: 'Поставка та CI/CD', CMP: 'Компоненти інтерфейсу', CRY: 'Криптоактиви', DAT: 'Дані', DOC: 'Документи', DS: 'Дизайн-система',
  FCS: 'Прогнози', FIN: 'Фінанси', FLW: 'Потоки', GRID: 'Таблиці', IMP: 'Імпорт', INS: 'Страхування', INT: 'Інтеграції', INV: 'Інвестиції',
  JRN: 'Подорожі користувача', L10N: 'Локалізація', LEG: 'Юридичні вимоги', NFR: 'Нефункціональні вимоги', NOT: 'Сповіщення', PLN: 'Плани', PLT: 'Платформа',
  PRC: 'Процес вимог', RPT: 'Звіти', SCR: 'Екрани', SUB: 'Підписки', SUP: 'Підтримка', UX: 'Взаємодія', VAL: 'Валідація', VLT: 'Сейф', WGT: 'Віджети',
};

/**
 * Block of every requirement ID from the blocks config (tools/progress-dashboard/blocks.json).
 * @param {{blocks: {id: string, ids: string[]}[]}} config
 * @param {string[]} ids  the PoC requirement IDs
 * @returns {{block: Map<string, string>, unmapped: string[], duplicated: string[], stale: string[]}}
 */
export function assignBlocks(config, ids) {
  const block = new Map();
  const duplicated = new Set();
  for (const b of config.blocks) for (const id of b.ids) {
    if (block.has(id)) duplicated.add(id);
    else block.set(id, b.id);
  }
  return { block, unmapped: ids.filter((id) => !block.has(id)), duplicated: [...duplicated], stale: [...block.keys()].filter((id) => !ids.includes(id)) };
}

/** Status of a PoC feature whose view has no numbered FR, AC or EC: readiness is not measured (owner, 2026-11-27). */
export const NO_ITEMS = 'немає пунктів для підрахунку';

/**
 * The features of the PoC release for the progress page: one per requirement that has a PoC view. Status:
 * «готово» — every FR, AC and EC named by a test and no fingerprint error; «у роботі» — some covered (an open PR
 * that names the ID is added by the page, from the GitHub API); «не почато» — none covered; «немає пунктів для
 * підрахунку» — the view has no numbered FR, AC or EC (items.total = 0), so readiness is not measured (owner,
 * 2026-11-27). A requirement that is not in the PoC release is not listed.
 * @param {ReturnType<typeof computeCoverage>} cov
 * @param {{titles: Map<string, string>, fingerprintErrors: Map<string, number>, blocks?: {blocks: {id: string, ids: string[]}[]}|null}} meta
 */
export function featuresSummary(cov, { titles, fingerprintErrors, blocks = null }) {
  const out = [];
  const map = blocks ? assignBlocks(blocks, cov.rows.filter((x) => x.release === 'PoC').map((x) => x.id)).block : new Map();
  for (const r of cov.rows.filter((x) => x.release === 'PoC')) {
    const covered = r.FR.covered + r.AC.covered + r.EC.covered;
    const total = r.FR.total + r.AC.total + r.EC.total;
    const fp = fingerprintErrors.get(r.id) ?? 0;
    const status = total === 0 ? NO_ITEMS : covered === total && fp === 0 ? 'готово' : covered > 0 ? 'у роботі' : 'не почато';
    const prefix = r.id.slice(0, r.id.indexOf('-'));
    out.push({ id: r.id, title: titles.get(r.id) ?? '', section: prefix, sectionName: SECTION_NAMES[prefix] ?? prefix, block: map.get(r.id) ?? 'other', FR: { covered: r.FR.covered, total: r.FR.total }, AC: { covered: r.AC.covered, total: r.AC.total }, EC: { covered: r.EC.covered, total: r.EC.total }, items: { covered, total }, fingerprintErrors: fp, status });
  }
  return out;
}
