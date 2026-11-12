// Runs every check over a corpus. No I/O.
import { Findings, sortFindings } from './findings.mjs';
import { checkStructure } from './checks/structure.mjs';
import { checkRelease } from './checks/release.mjs';
import { checkSelfContained } from './checks/self-contained.mjs';
import { checkCriteria } from './checks/criteria.mjs';
import { checkFacts } from './checks/facts.mjs';
import { checkLinks } from './checks/links.mjs';
import { checkSources } from './checks/source.mjs';
import { makeRegistries } from './registries.mjs';

/**
 * @param {ReturnType<import('./corpus.mjs').buildCorpus>} corpus
 * @param {{facts: object[]}} factsSpec
 * @param {import('./registries.mjs').Registries} [registries] screens, use cases, files (default: empty)
 */
export function runChecks(corpus, factsSpec, registries = makeRegistries()) {
  const out = new Findings(redirectToSource(corpus));
  const { readmeRows } = checkStructure(corpus, out);
  const release = checkRelease(corpus, out, readmeRows);
  checkSelfContained(corpus, out);
  const criteria = checkCriteria(corpus, out);
  const facts = checkFacts(corpus, out, factsSpec);
  const model = checkLinks(corpus, out, registries);
  checkSources(corpus, out);
  return { findings: sortFindings(out.list), release, criteria, facts, model };
}

/**
 * Findings in a generated view point at the source line it came from, prefixed with the slice ID
 * («BUD-16@PoC v2: …»): the source is what gets edited.
 */
export function redirectToSource(corpus) {
  const views = new Map(corpus.docs.filter((d) => d.generated).map((d) => [d.rel, d.generated]));
  if (!views.size) return null;
  return (file, line) => {
    const g = views.get(file);
    if (!g) return null;
    const src = line > 0 ? g.lineMap[line - 1] : undefined;
    return { file: g.sourceRel, line: src === undefined ? 0 : src + 1, prefix: `${g.sid}: ` };
  };
}
