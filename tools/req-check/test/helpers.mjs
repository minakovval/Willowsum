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
