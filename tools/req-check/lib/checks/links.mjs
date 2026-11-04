// Check 6: release slices, cards and link headers.
import { SLICE_FIELDS, CARD_FIELDS, SHARED_AREAS, REF_RE, SECTION, releaseIndex } from '../config.mjs';
import { findSection } from '../markdown.mjs';
import { parseReleaseLine, mainPriority } from '../release.mjs';
import { field } from '../links.mjs';
import { buildModel } from '../model.mjs';

const CHECK = 'links';

/**
 * @param {ReturnType<import('../corpus.mjs').buildCorpus>} corpus
 * @param {import('../findings.mjs').Findings} out
 * @param {import('../registries.mjs').Registries} registries
 * @param {ReturnType<typeof buildModel>} [model]
 */
export function checkLinks(corpus, out, registries, model = buildModel(corpus)) {
  const add = (rule, d, index, key, message) => out.add({ check: CHECK, rule, file: d.rel, line: index + 1, key, message });

  /** Shared block checks: syntax, single block, position right after the release line, field order. */
  const checkBlock = (d, block, expected) => {
    for (const p of block.problems) add('link-syntax', d, p.index, `syntax:${p.index - block.start}`, p.message);
    for (const i of block.extra) add('link-block-duplicate', d, i, `dup:${i}`, 'only one «Зв\'язки» block is allowed, right after the release line');
    const rl = parseReleaseLine(d.lines);
    const after = rl ? rl.line : 1; // 0-based index of the line after the release line (or after the heading)
    let first = after;
    while (first < d.lines.length && d.lines[first].trim() === '') first++;
    if (block.start !== first) add('link-block-position', d, block.start, 'position', `the «Зв'язки» block must come right after the ${rl ? 'release line' : 'heading'}`);
    const names = block.fields.map((f) => f.name);
    if (names.join('|') !== expected.join('|')) {
      add('link-fields', d, block.start, 'fields', `link fields must be exactly, in this order: ${expected.map((n) => `«${n}»`).join(', ')}; found ${names.map((n) => `«${n}»`).join(', ') || 'none'}`);
    }
  };

  // «Модуль» may be empty only for shared areas (architecture, NFR, delivery, process …).
  const checkModules = (d, fl, area) => {
    if (!fl) return;
    if (!fl.values.length && !SHARED_AREAS.includes(area)) add('link-module-missing', d, fl.index, 'module', '«Модуль» must name at least one module from the ARC-01 catalogue');
    for (const m of fl.values) {
      if (!REF_RE.module.test(m) || (model.modules.size && !model.modules.has(m))) add('link-unknown-module', d, fl.index, `module:${m}`, `module "${m}" is not in the ARC-01 module catalogue`);
    }
  };

  // Requirement files with a link header: cards.
  for (const f of model.features.values()) {
    const d = f.doc;
    if (!f.block) continue;
    if (!f.card) {
      add('card-without-slices', d, f.block.start, 'card', 'a requirement file with a «Зв\'язки» block is a card and needs the «Зрізи» field');
      continue;
    }
    checkBlock(d, f.block, CARD_FIELDS);
    checkModules(d, field(f.block, 'Модуль'), f.area);
    for (const label of [SECTION.functional, SECTION.criteria]) {
      const sec = findSection(d.lines, label);
      if (sec) add('card-body', d, sec.start, label, `a card holds the purpose, slices and links only; «${label}» belongs in the slice files`);
    }
    const listed = field(f.block, 'Зрізи');
    const present = f.slices.map((s) => s.sid);
    for (const v of listed.values) {
      const m = REF_RE.slice.exec(v);
      if (!m || m[1] !== f.id) add('card-slices', d, listed.index, `bad:${v}`, `«Зрізи» lists "${v}"; expected slices of ${f.id} such as ${f.id}@PoC`);
    }
    if (listed.values.join('|') !== present.join('|')) {
      add('card-slices', d, listed.index, 'set', `«Зрізи» must list the slice files present, in release order: ${present.join(', ') || 'none'}; found ${listed.values.join(', ') || '—'}`);
    }
    const sliceReleases = f.slices.map((s) => s.release);
    if (f.releases.join('|') !== sliceReleases.join('|')) {
      add('card-release', d, (f.releaseLine?.line ?? 1) - 1, 'releases', `the release line names ${f.releases.join(', ') || 'no release'}, but the slice files are for ${sliceReleases.join(', ') || 'no release'}`);
    }
  }

  // Slice files without a card.
  for (const d of model.orphans) {
    const f = model.features.get(d.id);
    add('slice-without-card', d, 0, 'card', f ? `${d.id}.md is not a card (it has no «Зв'язки» block with «Зрізи»); migrate it or remove the slice` : `no requirement file ${d.id}.md for this slice`);
  }

  // Explicit slices.
  for (const f of model.features.values()) {
    if (!f.card) continue;
    f.slices.forEach((s, k) => {
      const d = s.doc;
      const hm = /^# (.+?) · (.+)$/u.exec(d.lines[0] ?? '');
      const h = hm ? { id: hm[1], title: hm[2].trim() } : null;
      if (!h || h.id !== s.sid || h.title !== f.title) add('slice-heading', d, 0, 'heading', `first line must be "# ${s.sid} · ${f.title}"`);
      const rl = parseReleaseLine(d.lines);
      const cardPriority = f.releaseLine?.priority;
      if (!rl || rl.releaseText !== s.release || (cardPriority && mainPriority(rl.priorityText ?? '') !== cardPriority)) {
        add('slice-release', d, (rl?.line ?? 3) - 1, 'release', `release line must be "**Реліз:** ${s.release} · **Пріоритет:** ${cardPriority ?? '<M|S|C>'}"`);
      }
      if (!s.block) {
        add('link-block-missing', d, 0, 'block', `a slice needs a «Зв'язки» block after the release line with the fields ${SLICE_FIELDS.map((n) => `«${n}»`).join(', ')}`);
        return;
      }
      checkBlock(d, s.block, SLICE_FIELDS);
      const own = releaseIndex(s.release);
      const fl = (name) => field(s.block, name);

      // «Розширює»: exactly the same feature's previous slice; nothing for the first one.
      const ext = fl('Розширює');
      if (ext) {
        const prev = f.slices[k - 1];
        const want = prev ? [prev.sid] : [];
        if (ext.values.join('|') !== want.join('|')) {
          add('extends-invalid', d, ext.index, 'extends', prev ? `«Розширює» must be exactly ${prev.sid}, the previous slice of ${f.id}` : `«Розширює» must be «—»: this is the first slice of ${f.id}`);
        }
      }

      // «Залежить від»: slices of other requirements (or requirements without a release), same or earlier release.
      const dep = fl('Залежить від');
      for (const v of dep?.values ?? []) {
        const sm = REF_RE.slice.exec(v);
        if (sm) {
          const target = model.slices.get(v);
          if (v === s.sid) add('depends-self', d, dep.index, `dep:${v}`, `${s.sid} depends on itself`);
          else if (!target) add('link-unknown-id', d, dep.index, `dep:${v}`, model.features.has(sm[1]) ? `${sm[1]} has no ${sm[2]} slice (its releases: ${model.features.get(sm[1]).releases.join(', ') || 'none'})` : `unknown requirement ${sm[1]}`);
          else if (releaseIndex(target.release) > own) add('depends-later-release', d, dep.index, `dep:${v}`, `${s.sid} depends on ${v} from a later release`);
          else {
            const inEffect = target.feature.slices.filter((x) => releaseIndex(x.release) <= own).pop();
            if (inEffect && inEffect.sid !== v) add('depends-stale-slice', d, dep.index, `dep:${v}`, `in ${s.release} the slice of ${sm[1]} in effect is ${inEffect.sid}, not ${v}`);
          }
          continue;
        }
        if (REF_RE.requirement.test(v)) {
          const t = model.features.get(v);
          if (!t) add('link-unknown-id', d, dep.index, `dep:${v}`, `unknown requirement ${v}`);
          else if (t.releases.length) add('depends-needs-release', d, dep.index, `dep:${v}`, `name the slice, e.g. ${v}@${t.releases.filter((r) => releaseIndex(r) <= own).pop() ?? t.releases[0]}`);
          continue;
        }
        add('link-wrong-field', d, dep.index, `dep:${v}`, `"${v}" is not a requirement or slice ID; screens go to «Дизайн», П-rules to «Спільні правила», use cases to «Сценарії»`);
      }

      // «Дизайн»: screens of the screen map and canvas board names.
      const des = fl('Дизайн');
      for (const v of des?.values ?? []) {
        if (REF_RE.screen.test(v)) {
          if (!registries.screens) add('link-registry-missing', d, des.index, `screen:${v}`, `cannot check ${v}: docs/ux/screen-map.md not found`);
          else if (!registries.screens.has(v)) add('link-unknown-screen', d, des.index, `screen:${v}`, `screen ${v} is not in docs/ux/screen-map.md`);
        } else if (!REF_RE.board.test(v) || REF_RE.requirement.test(v)) {
          add('link-wrong-field', d, des.index, `design:${v}`, `«Дизайн» takes screen IDs (S-121) and canvas board names (PocPlanBudget); found "${v}"`);
        }
      }

      // «Спільні правила»: П-n and shared-area requirements available by this release.
      const sh = fl('Спільні правила');
      for (const v of sh?.values ?? []) {
        if (REF_RE.rule.test(v)) {
          if (!model.rules.has(v)) add('link-unknown-rule', d, sh.index, `rule:${v}`, `general rule ${v} is not in 00-general.md`);
          continue;
        }
        const sm = REF_RE.slice.exec(v);
        const id = sm ? sm[1] : REF_RE.requirement.test(v) ? v : null;
        if (!id) {
          add('link-wrong-field', d, sh.index, `shared:${v}`, `«Спільні правила» takes П-n and requirement IDs of ${SHARED_AREAS.join(', ')}; found "${v}"`);
          continue;
        }
        const t = model.features.get(id);
        if (!t) {
          add('link-unknown-id', d, sh.index, `shared:${v}`, `unknown requirement ${id}`);
          continue;
        }
        if (!SHARED_AREAS.includes(t.area)) add('shared-not-shared', d, sh.index, `shared:${v}`, `${id} is a feature requirement, not a shared rule; put it in «Залежить від»`);
        const avail = sm ? (model.slices.get(v) ? sm[2] : null) : t.firstRelease;
        if (sm && !model.slices.has(v)) add('link-unknown-id', d, sh.index, `shared:${v}`, `${id} has no ${sm[2]} slice`);
        else if (avail && releaseIndex(avail) > own) add('shared-later-release', d, sh.index, `shared:${v}`, `${v} starts in ${avail}, later than ${s.release}`);
      }

      // «Сценарії».
      const uc = fl('Сценарії');
      for (const v of uc?.values ?? []) {
        if (!REF_RE.useCase.test(v)) add('link-wrong-field', d, uc.index, `uc:${v}`, `«Сценарії» takes use-case IDs (UC-BUD-03); found "${v}"`);
        else if (!registries.useCases) add('link-registry-missing', d, uc.index, `uc:${v}`, `cannot check ${v}: docs/ux/use-cases not found`);
        else if (!registries.useCases.has(v)) add('link-unknown-use-case', d, uc.index, `uc:${v}`, `use case ${v} is not in docs/ux/use-cases`);
      }

      checkModules(d, fl('Модуль'), f.area);

      // «Перевіряється»: repository paths that exist.
      const ts = fl('Перевіряється');
      for (const v of ts?.values ?? []) {
        if (!registries.fileExists(v)) add('link-unknown-test', d, ts.index, `test:${v}`, `test path "${v}" does not exist in the repository`);
      }
    });
  }

  // A card's «Модуль» is exactly the union of its slices' modules.
  for (const f of model.features.values()) {
    if (!f.card || !f.slices.length) continue;
    const fl = field(f.block, 'Модуль');
    if (!fl) continue;
    const used = [...new Set(f.slices.flatMap((s) => s.links.modules))].sort();
    const listed = [...new Set(fl.values)].sort();
    if (used.join('|') !== listed.join('|')) {
      add('card-module', f.doc, fl.index, 'modules', `the card's «Модуль» must be the modules of its slices: ${used.join(', ') || '—'}; found ${listed.join(', ') || '—'}`);
    }
  }

  // Dependency cycles over explicit slices.
  for (const cycle of findCycles(model)) {
    const first = model.slices.get(cycle[0]);
    add('depends-cycle', first.doc, first.block?.start ?? 0, `cycle:${[...cycle].sort().join(',')}`, `dependency cycle: ${[...cycle, cycle[0]].join(' → ')}`);
  }
  return model;
}

/** Elementary cycles found by DFS over «Залежить від» edges (one report per strongly connected loop). */
export function findCycles(model) {
  const state = new Map();
  const stack = [];
  const cycles = [];
  const seen = new Set();
  const visit = (sid) => {
    state.set(sid, 1);
    stack.push(sid);
    for (const t of model.slices.get(sid)?.links.depends ?? []) {
      if (!model.slices.has(t)) continue;
      if (state.get(t) === 1) {
        const cyc = stack.slice(stack.indexOf(t));
        const key = [...cyc].sort().join(',');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cyc);
        }
      } else if (!state.has(t)) visit(t);
    }
    stack.pop();
    state.set(sid, 2);
  };
  for (const sid of [...model.slices.keys()].sort()) if (!state.has(sid)) visit(sid);
  return cycles;
}
