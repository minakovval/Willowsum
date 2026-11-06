/**
 * CICD-06 FR 2 (CI job `api`): every flag has an owner and a review date; fails for a flag past its review
 * date, a release flag fully enabled for more than 30 days (remove it from the code), and a function of the
 * feature catalogue without a flag (ARC-01 FR 7). Today is the UTC date of the run.
 */
import { flagReviewProblems, FLAGS, utcDay } from "../src/modules/feature-flags/index.ts";
import { FEATURE_KEYS } from "../src/modules/plan-catalog/index.ts";

const problems = flagReviewProblems(FLAGS, utcDay(new Date()), FEATURE_KEYS);
if (problems.length > 0) {
  console.error(`Feature flags (CICD-06):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(
  `Feature flags: ${Object.keys(FLAGS).length} flag(s), each with an owner and a review date; none stale`,
);
