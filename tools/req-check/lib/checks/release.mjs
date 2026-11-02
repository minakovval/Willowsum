// Check 2: release/priority line present and valid where the folder's requirement kind carries it.
import { FOLDER_MAJORITY, RELEASES, PRIORITIES } from '../config.mjs';
import { parseReleaseLine } from '../release.mjs';

const CHECK = 'release';

/**
 * A folder must carry a field when most of its files have it. A single file is exempt when
 * its module README row leaves that cell empty (declared "n/a").
 * @param {ReturnType<import('../corpus.mjs').buildCorpus>} corpus
 * @param {import('../findings.mjs').Findings} out
 * @param {Map<string, {release: string, priority: string}>} readmeRows
 */
export function checkRelease(corpus, out, readmeRows = new Map()) {
  const reqs = corpus.docs.filter((d) => d.kind === 'requirement' && d.id);
  const parsed = new Map(reqs.map((d) => [d.rel, parseReleaseLine(d.lines)]));
  const folders = [];
  const exemptFiles = [];

  for (const folder of corpus.folders) {
    const docs = reqs.filter((d) => d.folder === folder);
    if (!docs.length) continue;
    const withRelease = docs.filter((d) => parsed.get(d.rel)).length;
    const withPriority = docs.filter((d) => parsed.get(d.rel)?.priorityText != null).length;
    const needRelease = withRelease / docs.length >= FOLDER_MAJORITY;
    const needPriority = withPriority / docs.length >= FOLDER_MAJORITY;
    folders.push({ folder, files: docs.length, withRelease, withPriority, needRelease, needPriority });

    for (const d of docs) {
      const p = parsed.get(d.rel);
      const row = readmeRows.get(`${folder}/${d.id}`);
      const releaseDeclaredNA = row ? row.release === '' : false;
      const priorityDeclaredNA = row ? row.priority === '' : false;

      if (!p) {
        if (needRelease && !releaseDeclaredNA) {
          out.add({ check: CHECK, rule: 'release-missing', file: d.rel, line: 3, message: `missing "**Реліз:** <${RELEASES.join(' | ')}> · **Пріоритет:** <${PRIORITIES.join(' | ')}>" line` });
        } else if (needRelease) {
          exemptFiles.push({ file: d.rel, field: 'release', reason: 'README row has no release (n/a)' });
        }
        continue;
      }
      if (!p.release) {
        out.add({ check: CHECK, rule: 'release-invalid', file: d.rel, line: p.line, message: `release "${p.releaseText}" does not start with one of ${RELEASES.join(', ')}` });
      }
      if (p.priorityText == null) {
        if (needPriority && !priorityDeclaredNA) {
          out.add({ check: CHECK, rule: 'priority-missing', file: d.rel, line: p.line, message: `release line has no "**Пріоритет:** <${PRIORITIES.join(' | ')}>"` });
        } else if (needPriority) {
          exemptFiles.push({ file: d.rel, field: 'priority', reason: 'README row has no priority (n/a)' });
        }
      } else if (!p.priority) {
        out.add({ check: CHECK, rule: 'priority-invalid', file: d.rel, line: p.line, message: `priority "${p.priorityText}" is not one of ${PRIORITIES.join(', ')}` });
      }
    }
  }

  const releaseOf = new Map(reqs.map((d) => [d.rel, parsed.get(d.rel)?.release ?? (parsed.get(d.rel) ? 'invalid' : 'n/a')]));
  return { folders, exemptFiles, releaseOf };
}
