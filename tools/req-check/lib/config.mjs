// Static rules of the requirements checker. Product facts live in ../facts.json.

/** Valid main release values, longest first so that `v1-mobile` wins over `v1`. */
export const RELEASES = ['v1-mobile', 'MVP', 'Сейф', 'v1', 'v2'];

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
