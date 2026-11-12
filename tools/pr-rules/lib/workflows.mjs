// The CI jobs every PR must pass (CICD-01 FR 3): the jobs of the PR workflows, as their check runs are named.

/** Workflows whose jobs are required on every PR. The label workflow is informational and not listed. */
export const REQUIRED_WORKFLOWS = ['.github/workflows/pr-checks.yml', '.github/workflows/pr-description.yml'];

/** Check-run names of a workflow's jobs: the job's `name:` when it is a plain string, else its key. */
export function jobNames(yamlText) {
  const names = [];
  const lines = yamlText.replace(/\r\n/g, '\n').split('\n');
  let inJobs = false;
  let current = null;
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
      current = { key: key[1], name: null };
      names.push(current);
      continue;
    }
    const name = /^ {4}name:\s*(['"]?)([^'"#$]+?)\1\s*(#.*)?$/.exec(line);
    if (current && name) current.name = name[2].trim();
  }
  return names.map((j) => j.name ?? j.key);
}
