// Runs every check over a corpus. No I/O.
import { Findings, sortFindings } from './findings.mjs';
import { checkStructure } from './checks/structure.mjs';
import { checkRelease } from './checks/release.mjs';
import { checkSelfContained } from './checks/self-contained.mjs';
import { checkCriteria } from './checks/criteria.mjs';
import { checkFacts } from './checks/facts.mjs';

/**
 * @param {ReturnType<import('./corpus.mjs').buildCorpus>} corpus
 * @param {{facts: object[]}} factsSpec
 */
export function runChecks(corpus, factsSpec) {
  const out = new Findings();
  const { readmeRows } = checkStructure(corpus, out);
  const release = checkRelease(corpus, out, readmeRows);
  checkSelfContained(corpus, out);
  const criteria = checkCriteria(corpus, out);
  const facts = checkFacts(corpus, out, factsSpec);
  return { findings: sortFindings(out.list), release, criteria, facts };
}
