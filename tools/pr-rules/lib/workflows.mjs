// The CI jobs every PR must pass (CICD-01 FR 3): the jobs of the PR workflows, as their check runs are named.

/** Workflows whose jobs are required on every PR. The label workflow is informational and not listed. */
export const REQUIRED_WORKFLOWS = ['.github/workflows/pr-checks.yml', '.github/workflows/pr-description.yml'];

/**
 * Check-run names of a workflow's jobs: the job's `name:` when it is a plain string, else its key. A job whose
 * `name:` is a matrix expression (`api ${{ matrix.part }}`) runs as several check runs named by their matrix values,
 * none of them by the job's key; when another job of the workflow `needs` it, that aggregate job is the required
 * check for it (it fails unless every part passed), so the matrix job itself is not listed. A matrix job that no
 * other job needs stays listed by its key, so the daily check reports it as never run instead of losing it.
 */
export function jobNames(yamlText) {
  const jobs = [];
  const lines = yamlText.replace(/\r\n/g, '\n').split('\n');
  let inJobs = false;
  let current = null;
  let inNeedsList = false;
  for (const line of lines) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^\S/.test(line)) {
      inJobs = /^jobs:\s*(#.*)?$/.test(line);
      current = null;
      continue;
    }
    if (!inJobs) continue;
    const key = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
    if (key) {
      current = { key: key[1], name: null, matrixName: false, needs: [] };
      jobs.push(current);
      inNeedsList = false;
      continue;
    }
    if (!current) continue;
    if (inNeedsList) {
      const item = /^ {6}- ([A-Za-z0-9_-]+)\s*(#.*)?$/.exec(line);
      if (item) {
        current.needs.push(item[1]);
        continue;
      }
      inNeedsList = false;
    }
    const needs = /^ {4}needs:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (needs) {
      if (needs[1] === '') inNeedsList = true;
      else current.needs.push(...needs[1].replace(/^\[|\]$/g, '').split(',').map((n) => n.trim()).filter(Boolean));
      continue;
    }
    const name = /^ {4}name:\s*(['"]?)([^'"#$]+?)\1\s*(#.*)?$/.exec(line);
    if (name) current.name = name[2].trim();
    else if (/^ {4}name:.*\$\{\{\s*matrix\./.test(line)) current.matrixName = true;
  }
  const needed = new Set(jobs.flatMap((j) => j.needs));
  return jobs.filter((j) => !(j.matrixName && needed.has(j.key))).map((j) => j.name ?? j.key);
}
