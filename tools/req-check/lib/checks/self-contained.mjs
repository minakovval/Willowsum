// Check 3: no other requirement IDs inside a requirement body; no forbidden words.
// IDs are allowed only in the «Зв'язки» link header of a card or a slice (checked by checks/links.mjs).
import { ID_LIKE_RE, TECHNICAL_TERMS, FORBIDDEN_WORDS } from '../config.mjs';
import { codeSpanRanges, inRanges } from '../markdown.mjs';
import { parseLinkBlock } from '../links.mjs';

const CHECK = 'self-contained';

/**
 * @param {ReturnType<import('../corpus.mjs').buildCorpus>} corpus
 * @param {import('../findings.mjs').Findings} out
 */
export function checkSelfContained(corpus, out) {
  const technical = new Set(TECHNICAL_TERMS);
  for (const d of corpus.docs) {
    const isRequirement = d.kind === 'requirement' || d.kind === 'slice';
    const block = isRequirement ? parseLinkBlock(d.lines) : null;
    const inBlock = (i) => block && i >= block.start && i < block.end;
    d.lines.forEach((line, i) => {
      const lineNo = i + 1;

      // Foreign IDs: only requirement bodies (00-general.md and READMEs may cite IDs).
      if (isRequirement && i > 0 && !inBlock(i)) {
        for (const m of line.matchAll(ID_LIKE_RE)) {
          const ref = m[0];
          if (ref === d.id || technical.has(ref)) continue;
          out.add({ check: CHECK, rule: 'foreign-id', file: d.rel, line: lineNo, key: ref, message: `mentions another requirement ID "${ref}"; requirement files must be self-contained` });
        }
      }

      // Forbidden words: every file.
      for (const { word, re } of FORBIDDEN_WORDS) {
        for (const m of line.matchAll(re)) {
          out.add({ check: CHECK, rule: 'forbidden-word', file: d.rel, line: lineNo, key: word, message: `forbidden word ${word} ("${context(line, m.index)}")` });
        }
      }
      const spans = line.includes('$') ? codeSpanRanges(line) : [];
      for (const m of line.matchAll(/\$/g)) {
        const inCode = inRanges(spans, m.index);
        out.add({
          check: CHECK,
          rule: inCode ? 'dollar-in-code' : 'forbidden-word',
          severity: inCode ? 'warning' : 'error',
          file: d.rel,
          line: lineNo,
          key: '$',
          message: `${inCode ? '"$" inside a code span' : 'forbidden "$" (amounts are in EUR/UAH)'} ("${context(line, m.index)}")`,
        });
      }
    });
  }
}

function context(line, index, width = 30) {
  return line.slice(Math.max(0, index - width), index + width).replace(/\s+/g, ' ').trim();
}
