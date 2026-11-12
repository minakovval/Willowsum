// Impact analysis: everything that depends on a requirement, slice, screen, canvas board, general
// rule, use case or module, found transitively through the link headers.
import { REF_RE, SHARED_AREAS, releaseIndex } from './config.mjs';

/**
 * Classify the target and return the seed slices with the reason each one is affected.
 * @returns {{kind: string, seeds: Map<string, string>}|null}
 */
function seedsOf(target, model, registries) {
  const seeds = new Map();
  const all = [...model.slices.values()];
  const withLink = (key, value, why) => {
    for (const s of all) if (s.links[key].includes(value)) seeds.set(s.sid, why);
  };
  if (REF_RE.slice.test(target)) {
    if (!model.slices.has(target)) return null;
    seeds.set(target, 'changed slice');
    return { kind: 'slice', seeds };
  }
  if (REF_RE.requirement.test(target)) {
    const f = model.features.get(target);
    if (!f) return null;
    for (const s of f.slices) seeds.set(s.sid, 'slice of the changed requirement');
    // A shared rule is cited by requirement ID or by slice ID.
    for (const s of all) {
      if (s.links.shared.some((v) => v === target || v.startsWith(`${target}@`))) seeds.set(s.sid, `«Спільні правила» cites ${target}`);
    }
    return { kind: SHARED_AREAS.includes(f.area) ? 'shared requirement' : 'requirement', seeds };
  }
  if (REF_RE.rule.test(target)) {
    if (!model.rules.has(target)) return null;
    withLink('shared', target, `«Спільні правила» cites ${target}`);
    return { kind: 'general rule', seeds };
  }
  if (REF_RE.screen.test(target)) {
    if (registries.screens && !registries.screens.has(target)) return null;
    withLink('design', target, `«Дизайн» lists ${target}`);
    return { kind: 'screen', seeds };
  }
  if (REF_RE.useCase.test(target)) {
    if (registries.useCases && !registries.useCases.has(target)) return null;
    withLink('useCases', target, `«Сценарії» lists ${target}`);
    return { kind: 'use case', seeds };
  }
  if (REF_RE.module.test(target)) {
    if (model.modules.size && !model.modules.has(target)) return null;
    withLink('modules', target, `«Модуль» is ${target}`);
    return { kind: 'module', seeds };
  }
  if (REF_RE.board.test(target)) {
    withLink('design', target, `«Дизайн» lists board ${target}`);
    return { kind: 'canvas board', seeds };
  }
  return null;
}

/**
 * @param {ReturnType<import('./model.mjs').buildModel>} model
 * @param {import('./registries.mjs').Registries} registries
 * @param {string} target
 */
export function computeImpact(model, registries, target) {
  const seeded = seedsOf(target, model, registries);
  if (!seeded) return null;

  // Reverse edges: who extends / depends on / cites a slice or its requirement.
  const rev = new Map();
  const addRev = (to, from, why) => {
    if (!rev.has(to)) rev.set(to, []);
    rev.get(to).push({ from, why });
  };
  for (const s of model.slices.values()) {
    for (const t of s.links.depends) addRev(t, s.sid, `«Залежить від» ${t}`);
    for (const t of s.links.extends) addRev(t, s.sid, `«Розширює» ${t}`);
    for (const t of s.links.shared) {
      if (REF_RE.slice.test(t)) addRev(t, s.sid, `«Спільні правила» ${t}`);
      else if (REF_RE.requirement.test(t)) for (const x of model.features.get(t)?.slices ?? []) addRev(x.sid, s.sid, `«Спільні правила» ${t}`);
    }
  }

  /** @type {Map<string, {why: string, via: string|null, depth: number}>} */
  const affected = new Map();
  const queue = [];
  for (const [sid, why] of seeded.seeds) {
    affected.set(sid, { why, via: null, depth: 0 });
    queue.push(sid);
  }
  while (queue.length) {
    const sid = queue.shift();
    for (const { from, why } of rev.get(sid) ?? []) {
      if (affected.has(from)) continue;
      affected.set(from, { why, via: sid, depth: affected.get(sid).depth + 1 });
      queue.push(from);
    }
  }

  const slices = [...affected.keys()]
    .map((sid) => model.slices.get(sid))
    .sort((a, b) => affected.get(a.sid).depth - affected.get(b.sid).depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : releaseIndex(a.release) - releaseIndex(b.release)));
  const uniq = (xs) => [...new Set(xs)].sort();
  const features = uniq(slices.map((s) => s.id)).map((id) => model.features.get(id));
  const ids = new Set(features.map((f) => f.id));

  // Mentions in docs/ux (screen map, use cases, journeys) of the target and of the affected requirements.
  const mentions = [];
  const needles = uniq([target, ...ids]);
  const res = needles.map((n) => new RegExp(`(?<![A-Za-z0-9-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'u'));
  for (const doc of registries.uxDocs ?? []) {
    doc.lines.forEach((line, i) => {
      const hit = needles.filter((_, k) => res[k].test(line));
      if (hit.length) mentions.push({ file: doc.rel, line: i + 1, ids: hit });
    });
  }

  return {
    target,
    kind: seeded.kind,
    slices: slices.map((s) => ({ ...affected.get(s.sid), slice: s })),
    // A generated view is edited through its source (the requirement file), then regenerated with --views.
    files: uniq(slices.flatMap((s) => [s.doc.generated ? s.doc.generated.sourceRel : s.doc.rel, s.feature.doc.rel, `${s.feature.doc.rel.split('/').slice(0, -1).join('/')}/README.md`])),
    design: uniq(slices.flatMap((s) => s.links.design)),
    useCases: uniq(slices.flatMap((s) => s.links.useCases)),
    shared: uniq(slices.flatMap((s) => s.links.shared)),
    tests: uniq(slices.flatMap((s) => s.links.tests)),
    modules: uniq([...slices.flatMap((s) => s.links.modules), ...features.flatMap((f) => f.modules)]),
    notMigrated: uniq(slices.filter((s) => !s.explicit).map((s) => s.id)),
    mentions,
  };
}

/** Markdown report of an impact analysis. */
export function renderImpact(impact) {
  const L = [`# Impact of ${impact.target} (${impact.kind})`, ''];
  L.push('Found through the «Зв\'язки» headers: slices that extend, depend on or cite the target, transitively. Update them in the same PR, or record each one as a follow-up issue in the PR body.', '');
  L.push(`## Affected slices (${impact.slices.length})`, '');
  if (impact.slices.length) {
    L.push('| Slice | Release | State | Why | Via |', '| --- | --- | --- | --- | --- |');
    for (const a of impact.slices) L.push(`| ${a.slice.sid} | ${a.slice.release} | ${a.slice.explicit ? 'мігровано' : 'не мігровано'} | ${a.why} | ${a.via ?? '—'} |`);
  } else L.push('None.');
  L.push('');
  if (impact.notMigrated.length) L.push(`Not migrated (links unknown — check by hand): ${impact.notMigrated.join(', ')}.`, '');
  const sec = (title, items, empty = 'None.') => {
    L.push(`## ${title}`, '');
    L.push(items.length ? items.map((x) => `- ${x}`).join('\n') : empty);
    L.push('');
  };
  sec('Requirement files and module READMEs', [...impact.files, 'docs/requirements/README.md (module table: counts and release mix)']);
  sec('Design: screens and canvas boards (keep board and slice in agreement)', impact.design);
  sec('Use cases', impact.useCases);
  sec('Mentions in docs/ux (screen map, use cases, journeys)', impact.mentions.map((m) => `${m.file}:${m.line} — ${m.ids.join(', ')}`));
  sec('Shared rules cited by the affected slices', impact.shared);
  sec('Tests («Перевіряється»)', impact.tests, 'None linked yet.');
  sec('Code modules', impact.modules.map((m) => `${m} — apps/api/src/modules/${m}`));
  sec('Generated and external artifacts', [
    'Release views of the changed sources (<ID>.<release>.md) — regenerate: node tools/req-check/index.mjs --views',
    'docs/traceability/ — regenerate: node tools/req-check/index.mjs --traceability',
    'docs/validation/req-check-report.md — regenerate: node tools/req-check/index.mjs --report docs/validation/req-check-report.md',
    'Release-features Google Sheet (outside the repository) — update the rows of the affected requirements by hand',
  ]);
  return L.join('\n');
}
