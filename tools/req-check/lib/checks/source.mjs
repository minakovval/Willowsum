// Check 7: requirement sources and their generated release views (docs/requirements/README.md,
// «Source and generated release views»).
import { LINK_BLOCK_RE } from '../config.mjs';
import { SOURCE_MARKER } from '../source.mjs';

const CHECK = 'source';
const ITEM_RE = /^\s*(?:\d+\.|#\.|[-*+]) /;

/**
 * @param {ReturnType<import('../corpus.mjs').buildCorpus>} corpus
 * @param {import('../findings.mjs').Findings} out
 */
export function checkSources(corpus, out) {
  for (const p of corpus.viewProblems ?? []) out.add({ check: CHECK, rule: p.rule, file: p.file, line: p.line, message: p.message });
  for (const s of corpus.sources ?? []) {
    const add = (rule, index, key, message) => out.add({ check: CHECK, rule, file: s.rel, line: index + 1, key, message });
    if (!s.src.separatorOk) add('source-marker', s.src.markerIndex, 'marker', `«${SOURCE_MARKER}» must follow a blank line that ends the card part`);
    if (!s.releases.length) add('source-no-views', 0, 'views', `the card part has no «Зрізи» line naming ${s.id}@<release>, so no view is generated`);
    let inLinks = false;
    for (const l of s.src.body) {
      if (LINK_BLOCK_RE.test(l.text.trim())) {
        inLinks = true;
        continue;
      }
      if (inLinks && !/^- /.test(l.text)) inLinks = false;
      if (l.bad) add('source-tag-invalid', l.index, `tag:${l.index}`, `"[${l.bad}]" is not a release tag; write [PoC], [PoC v2–MVP], [лише PoC] or a comma-separated list of these`);
      if (l.releases && !l.releases.some((r) => s.releases.includes(r))) add('source-tag-no-view', l.index, `noview:${l.index}`, `tag [${l.tag}] selects none of the views (${s.releases.join(', ')}); the line appears nowhere`);
      if (!inLinks && !l.releases && !l.bad && ITEM_RE.test(l.text)) add('source-item-untagged', l.index, `item:${l.index}`, `list item without a release tag: "${l.text.slice(0, 60)}"; start it with [<release>], e.g. "#. [${s.releases[0] ?? 'PoC'}] …"`);
    }
  }
}
