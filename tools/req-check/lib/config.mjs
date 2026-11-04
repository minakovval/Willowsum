// Static rules of the requirements checker. Product facts live in ../facts.json.

/** Valid main release values, longest first so that `v1-mobile` wins over `v1` and `PoC v2` over `PoC`. */
export const RELEASES = ['PoC v2', 'PoC', 'v1-mobile', 'MVP', 'Сейф', 'v1', 'v2'];

/** Valid priority values. */
export const PRIORITIES = ['M', 'S', 'C'];

/** A folder must carry a field when at least this share of its requirement files has it. */
export const FOLDER_MAJORITY = 0.5;

/** Requirement file name / ID shape. */
export const ID_FILE_RE = /^([A-Z][A-Z0-9]{1,4})-(\d{2})([a-z])?\.md$/;

/**
 * Anything that looks like a requirement ID. The look-behind keeps `SHA-256`, `X-FOO-01`
 * and the like out; the look-ahead stops at a digit or a Latin letter after the suffix.
 */
export const ID_LIKE_RE = /(?<![\p{L}\p{N}_-])([A-Z][A-Z0-9]{1,4})-(\d{2})([a-z])?(?![A-Za-z0-9_])/gu;

/**
 * Technical identifiers that have the shape of a requirement ID but are not one.
 * Add a term here only when it is a well-known external standard.
 */
export const TECHNICAL_TERMS = ['UTF-16', 'UTF-32', 'ERC-20', 'BIP-32', 'BIP-39', 'BIP-44'];

/**
 * Words that must not appear in requirement files: links to tools and documents outside
 * the repository, foreign-currency examples, and cross-references.
 */
export const FORBIDDEN_WORDS = [
  { word: 'KAN-', re: /(?<![\p{L}\p{N}])KAN-/gu },
  { word: 'BR-', re: /(?<![\p{L}\p{N}-])BR-/gu },
  { word: 'Confluence', re: /(?<![\p{L}])Confluence(?![\p{L}])/giu },
  { word: 'Jira', re: /(?<![\p{L}])Jira(?![\p{L}])/giu },
  { word: 'PRD', re: /(?<![\p{L}])PRD(?![\p{L}])/gu },
  { word: 'ADR-', re: /(?<![\p{L}\p{N}])ADR-/gu },
  { word: '«див.»', re: /(?<![\p{L}])[Дд]ив\./gu },
  { word: 'USD', re: /(?<![\p{L}])USD(?![\p{L}])/gu },
];

/** Bold section headers the checker understands. */
export const SECTION = {
  criteria: 'Критерії приймання',
  functional: 'Функціональні вимоги',
};

/**
 * Lines that start a new block and therefore end a numbered section: a heading, a bold
 * label (except a stray unnumbered Given/When/Then/And label, which is a criterion error),
 * or an «Припущення:» paragraph.
 */
export const SECTION_END_RE = /^(#|\*\*(?!(Given|When|Then|And)\*\*)|Припущення:)/u;

// ---------------------------------------------------------------------------------------------
// Release slices and link headers (docs/requirements/README.md, «Релізні зрізи і зв'язки»).

/** Releases that have slices, in build order. «Сейф» is part of MVP, not a release of its own. */
export const SLICE_RELEASES = ['PoC', 'PoC v2', 'MVP', 'v1-mobile', 'v1', 'v2'];

/** Release → file-name key: BUD-16.poc.md, BUD-16.poc-v2.md … */
export const RELEASE_KEY = { PoC: 'poc', 'PoC v2': 'poc-v2', MVP: 'mvp', 'v1-mobile': 'v1-mobile', v1: 'v1', v2: 'v2' };

/** Slice file name: `<ID>.<release key>.md`. */
export const SLICE_FILE_RE = /^([A-Z][A-Z0-9]{1,4}-\d{2}[a-z]?)\.(poc|poc-v2|mvp|v1-mobile|v1|v2)\.md$/;

/** Order of a release in SLICE_RELEASES («Сейф» counts as MVP); -1 when unknown. */
export function releaseIndex(r) {
  return SLICE_RELEASES.indexOf(r === 'Сейф' ? 'MVP' : r);
}

/** Label of the link header block. The apostrophe may be ' or ʼ or ’. */
export const LINK_BLOCK_RE = /^\*\*Зв['ʼ’]язки\*\*\s*$/u;

/** Fixed fields of a slice link header, in this order. */
export const SLICE_FIELDS = ['Розширює', 'Залежить від', 'Дизайн', 'Спільні правила', 'Сценарії', 'Модуль', 'Перевіряється'];

/** Fixed fields of a card link header, in this order. */
export const CARD_FIELDS = ['Зрізи', 'Модуль'];

/** The empty value of a link field. */
export const EMPTY_VALUE = '—';

/**
 * Areas whose requirements are shared rules that a slice may cite in «Спільні правила»
 * (design system, components, layout, charts, architecture, NFR, delivery, process, localisation, screens).
 */
export const SHARED_AREAS = ['DS', 'CMP', 'GRID', 'CHT', 'ARC', 'NFR', 'CICD', 'PRC', 'L10N', 'SCR'];

/** Where the cross-reference registries live, relative to the repository root. */
export const REGISTRY_PATHS = {
  screenMap: 'docs/ux/screen-map.md',
  useCases: 'docs/ux/use-cases',
};

/** Shapes of the IDs a link header may hold. */
export const REF_RE = {
  slice: /^([A-Z][A-Z0-9]{1,4}-\d{2}[a-z]?)@(PoC v2|PoC|MVP|v1-mobile|v1|v2)$/,
  requirement: /^[A-Z][A-Z0-9]{1,4}-\d{2}[a-z]?$/,
  rule: /^П-(\d+)$/u,
  screen: /^S-\d{3}[a-z]?$/,
  useCase: /^UC-[A-Z0-9]+-\d{2,3}[a-z]?$/,
  module: /^[a-z][a-z0-9-]*$/,
  board: /^[A-Z][A-Za-z0-9]+$/,
};
