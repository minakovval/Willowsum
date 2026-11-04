// Runs every check over a corpus. No I/O.
import { Findings, sortFindings } from './findings.mjs';
import { checkStructure } from './checks/structure.mjs';
import { checkRelease } from './checks/release.mjs';
import { checkSelfContained } from './checks/self-contained.mjs';
import { checkCriteria } from './checks/criteria.mjs';
import { checkFacts } from './checks/facts.mjs';
import { checkLinks } from './checks/links.mjs';
import { makeRegistries } from './registries.mjs';

/**
 * @param {ReturnType<import('./corpus.mjs').buildCorpus>} corpus
 * @param {{facts: object[]}} factsSpec
 * @param {import('./registries.mjs').Registries} [registries] screens, use cases, files (default: empty)
 */
export function runChecks(corpus, factsSpec, registries = makeRegistries()) {
  const out = new Findings();
  const { readmeRows } = checkStructure(corpus, out);
  const release = checkRelease(corpus, out, readmeRows);
  checkSelfContained(corpus, out);
  const criteria = checkCriteria(corpus, out);
  const facts = checkFacts(corpus, out, factsSpec);
  const model = checkLinks(corpus, out, registries);
  return { findings: sortFindings(out.list), release, criteria, facts, model };
}
