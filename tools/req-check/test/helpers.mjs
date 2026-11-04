// Fixture builders for the unit tests.
import { buildCorpus } from '../lib/corpus.mjs';
import { Findings } from '../lib/findings.mjs';

/** A valid functional requirement file. */
export function req(id, { title = 'Назва', release = '**Реліз:** MVP · **Пріоритет:** M', body = '', criteria } = {}) {
  const crit =
    criteria ??
    ['1. **Given** умова **When** дія **Then** результат.', '2. **Given** умова **And** ще умова **When** дія **Then** результат.'];
  return [
    `# ${id} · ${title}`,
    '',
    ...(release === null ? [] : [release, '']),
    '**Мета.** Як користувач, я хочу щось.',
    '',
    '**Функціональні вимоги**',
    '1. Перша вимога.',
    '2. Друга вимога.',
    '',
    body,
    '',
    '**Критерії приймання**',
    ...crit,
    '',
    '**Граничні випадки**',
    '- Випадок.',
    '',
  ].join('\n');
}

/** Module README listing the given rows: [id, title, release, priority]. */
export function readme(code, rows) {
  return [
    `# ${code} — module requirements`,
    '',
    '## Requirements',
    '',
    '| ID | Title | Release | Priority |',
    '| --- | --- | --- | --- |',
    ...rows.map(([id, title = 'Назва', release = 'MVP', priority = 'M']) => `| [${id}](${id}.md) | ${title} | ${release} | ${priority} |`),
    '',
  ].join('\n');
}

export function corpus(files) {
  return buildCorpus(Object.entries(files).map(([rel, text]) => ({ rel, text })));
}

export function collect(fn, ...args) {
  const out = new Findings();
  const result = fn(...args.slice(0, 1), out, ...args.slice(1));
  return { list: out.list, result };
}

export const rules = (list) => list.map((f) => f.rule).sort();

/** A card: heading, release line, «Зв'язки» with «Зрізи» and «Модуль», purpose. */
export function card(id, releases, { title = 'Назва', priority = 'S', module = 'budget', releaseText } = {}) {
  return [
    `# ${id} · ${title}`,
    '',
    `**Реліз:** ${releaseText ?? releases.map((r) => `${r} (обсяг)`).join('; ')} · **Пріоритет:** ${priority}`,
    '',
    "**Зв'язки**",
    `- Зрізи: ${releases.map((r) => `${id}@${r}`).join(', ')}`,
    `- Модуль: ${module}`,
    '',
    '**Мета.** Як користувач, я хочу щось.',
    '',
  ].join('\n');
}

/** A slice with a full link header. `links` maps field names to arrays of IDs. */
export function slice(id, release, links = {}, { title = 'Назва', priority = 'S', body = '', criteria } = {}) {
  const fields = ['Розширює', 'Залежить від', 'Дизайн', 'Спільні правила', 'Сценарії', 'Модуль', 'Перевіряється'];
  const defaults = { Модуль: ['budget'] };
  const crit = criteria ?? ['1. **Given** умова **When** дія **Then** результат.'];
  return [
    `# ${id}@${release} · ${title}`,
    '',
    `**Реліз:** ${release} · **Пріоритет:** ${priority}`,
    '',
    "**Зв'язки**",
    ...fields.map((f) => `- ${f}: ${(links[f] ?? defaults[f] ?? []).join(', ') || '—'}`),
    '',
    '**Мета.** Як користувач, я хочу щось.',
    '',
    '**Функціональні вимоги**',
    '1. Перша вимога.',
    '',
    body,
    '',
    '**Критерії приймання**',
    ...crit,
    '',
  ].join('\n');
}

/** 00-general.md with rules П-1…П-n and an ARC-01 file with a module catalogue. */
export function generalAndArc(rules = 26, modules = ['budget', 'cashflow', 'accounts']) {
  return {
    '00-general.md': ['# Загальне', '', '## 0.5 Загальні правила', '', '1. Гроші.', ...Array.from({ length: rules - 1 }, (_, i) => `- **П-${i + 2}.** Правило.`), '', '## 0.6 Глосарій', ''].join('\n'),
    'arc/ARC-01.md': ['# ARC-01 · Модулі', '', '**Реліз:** PoC · **Пріоритет:** M', '', '**Каталог модулів**', '', '| Домен | Модуль | Що |', '| --- | --- | --- |', ...modules.map((m) => `| Д | ${m} | щось |`), ''].join('\n'),
  };
}
