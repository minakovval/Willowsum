// Local run of the PR description and sensitive-label checks (owner, 2026-11-13; PRC-02): before pushing or
// PATCHing a PR body, an agent runs what the `traceability` job (pr-description.yml) and the label job
// (pr-sensitive-label.yml) will run, on the branch's diff against the base and the body file it is about to send.
// Same functions as CI (description.mjs, paths.mjs), so the two cannot disagree; only the file list comes from git.
import { execFileSync } from 'node:child_process';
import { PATHS_MODULE } from './fetch.mjs';
import { classifyFiles, ownerApprovalNeeded, ownerDecisionFiles, unionClassification } from './paths.mjs';

/**
 * Parse `git diff --name-status -z -M` output into the API's shape: `{ filename, previous_filename?, status }`.
 * A rename or copy (`R100`, `C75`) has two names: the old one first.
 */
export function parseNameStatus(text) {
  const parts = text.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    if (!code) continue;
    if (/^[RC]/.test(code)) {
      const previous = parts[i++];
      const filename = parts[i++];
      files.push({ filename, previous_filename: previous, status: code[0] === 'R' ? 'renamed' : 'copied' });
    } else {
      const status = { A: 'added', D: 'removed', M: 'modified', T: 'changed' }[code[0]] ?? 'modified';
      files.push({ filename: parts[i++], status });
    }
  }
  return files;
}

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/**
 * The branch's changed files against `base` (the merge base, as GitHub's PR file list), with the patch of
 * rule, requirement and workflow files and the full text of changed workflows (ownerApprovalNeeded reads it).
 */
export function changedFilesLocal(root, base) {
  const range = `${base}...HEAD`;
  const files = parseNameStatus(git(root, ['diff', '--name-status', '-z', '-M', range]));
  for (const f of files) {
    const needsPatch = /^(AGENTS\.md|CLAUDE\.md|\.claude\/|docs\/requirements\/|\.github\/workflows\/|infra\/)/.test(f.filename);
    if (!needsPatch) continue;
    f.patch = git(root, ['diff', range, '--', ...[f.previous_filename, f.filename].filter(Boolean)]);
    if (f.filename.startsWith('.github/workflows/') && f.status !== 'removed') {
      try {
        f.content = git(root, ['show', `HEAD:${f.filename}`]);
      } catch {
        f.unreadable = true;
      }
    }
  }
  return files;
}

/**
 * The sensitive-path map at the base, when the branch edits the map (CI judges such a PR by both maps). Fails
 * closed like baseMapFor: a map that cannot be loaded makes the PR sensitive.
 */
export async function baseMapLocal(root, base, files) {
  const names = files.flatMap((f) => [f.filename, f.previous_filename]);
  if (!names.includes(PATHS_MODULE)) return undefined;
  let text;
  try {
    text = git(root, ['show', `${base}:${PATHS_MODULE}`]);
  } catch {
    return undefined; // the map did not exist at the base
  }
  try {
    const map = await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
    return map.classifyPaths(files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)));
  } catch (e) {
    const why = `the map at ${base} could not be loaded (${String(e.message).slice(0, 100)})`;
    return { sensitive: true, categories: ['unlisted'], files: { unlisted: [why] } };
  }
}

/** What CI will decide for these files: sensitivity (labels), the owner-decision label, cloud/production approval. */
export async function localClassification(root, base, files) {
  const sensitive = unionClassification(classifyFiles(files), await baseMapLocal(root, base, files));
  return {
    sensitive,
    ownerDecision: ownerDecisionFiles(files),
    approval: ownerApprovalNeeded(files),
  };
}
