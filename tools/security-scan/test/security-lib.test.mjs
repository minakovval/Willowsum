// The decisions of the security job without running a scanner: severity thresholds, the allowlist, review dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateSast, evaluateSca, summarize, validateAllowlist } from '../lib.mjs';

const TODAY = '2026-11-27';
const LEAD = 'Рішення ведучого (2026-11-27; власник не схвалював)';
const OWNER = 'Рішення власника (2026-11-27): прийнято до перегляду';

const sastEntry = (over = {}) => ({
  rule: 'ws-sql-template-interpolation',
  path: 'apps/api/src/x.ts',
  match: 'ALTER TABLE ${t}',
  kind: 'false-positive',
  reason: 't is escapeIdentifier',
  owner: 'lead agent',
  decision: LEAD,
  review_by: '2027-05-27',
  ...over,
});
const scaEntry = (over = {}) => ({
  advisory: 'GHSA-g3hv-75wg-m249',
  package: 'minimatch',
  versions: ['9.0.5'],
  kind: 'accepted-risk',
  reason: 'build-only dependency',
  owner: 'product owner',
  decision: OWNER,
  review_by: '2027-02-27',
  ...over,
});
const list = (sast = [], sca = []) => ({ sast, sca });

const semgrepResult = (rule, path, line, severity = 'ERROR', securitySeverity = 'High') => ({
  check_id: `tools.security-scan.semgrep.${rule}`,
  path,
  start: { line },
  end: { line },
  extra: { severity, message: 'msg', metadata: { 'security-severity': securitySeverity } },
});
const SOURCE = { 'apps/api/src/x.ts': ['', 'await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);', 'await client.query(`DROP ${name}`);'] };
const sourceOf = (path, start, end) => (SOURCE[path] ?? []).slice(start - 1, end).join('\n');

const advisory = (id, pkg, severity, version) => ({
  github_advisory_id: id,
  module_name: pkg,
  severity,
  title: 't',
  url: `https://github.com/advisories/${id}`,
  findings: [{ version, paths: [`apps__api>${pkg}`] }],
});
const audit = (...advisories) => ({ advisories: Object.fromEntries(advisories.map((a, i) => [String(i), a])), metadata: {} });

test('CICD-02@PoC FR 12 «Статичний аналіз безпеки коду»: a High or Critical finding blocks; Medium is only reported', () => {
  const r = evaluateSast(
    { results: [semgrepResult('ws-eval', 'apps/api/src/x.ts', 3, 'ERROR', 'Critical'), semgrepResult('ws-other', 'apps/api/src/x.ts', 2, 'WARNING', 'Medium')], errors: [] },
    list(),
    sourceOf,
  );
  assert.equal(r.blocking.length, 1);
  assert.equal(r.reported.length, 1);
  const s = summarize('sast', r, []);
  assert.equal(s.ok, false);
  assert.match(s.annotations[0], /^::error file=apps\/api\/src\/x\.ts,line=3,title=ws-eval \(Critical\)::msg$/);
  assert.equal(summarize('sast', evaluateSast({ results: [semgrepResult('ws-other', 'a.ts', 1, 'WARNING')], errors: [] }, list(), sourceOf), []).ok, true);
});

test('CICD-02@PoC FR 12 «Статичний аналіз безпеки коду»: a rule or config error fails closed; a partly parsed file does not', () => {
  const failed = evaluateSast({ results: [], errors: [{ level: 'error', message: 'Invalid YAML' }] }, list(), sourceOf);
  assert.equal(summarize('sast', failed, []).ok, false);
  const partial = evaluateSast({ results: [], errors: [{ level: 'warn', type: ['PartialParsing'] }] }, list(), sourceOf);
  assert.equal(summarize('sast', partial, []).ok, true);
});

test('CICD-02@PoC FR 12 «Статичний аналіз безпеки коду»: an allowlisted finding passes only for its rule, file and code; a stale entry fails', () => {
  const report = { results: [semgrepResult('ws-sql-template-interpolation', 'apps/api/src/x.ts', 2)], errors: [] };
  const ok = evaluateSast(report, list([sastEntry()]), sourceOf);
  assert.equal(ok.blocking.length, 0);
  assert.equal(ok.allowed.length, 1);
  assert.equal(summarize('sast', ok, []).ok, true);
  // The same entry does not cover another line of the file, another rule or another file.
  const other = evaluateSast({ results: [semgrepResult('ws-sql-template-interpolation', 'apps/api/src/x.ts', 3)], errors: [] }, list([sastEntry()]), sourceOf);
  assert.equal(other.blocking.length, 1);
  assert.equal(other.stale.length, 1, 'the entry that matched nothing is stale in a full scan');
  assert.equal(summarize('sast', other, []).ok, false);
  assert.equal(evaluateSast({ results: [semgrepResult('ws-eval', 'apps/api/src/x.ts', 2)], errors: [] }, list([sastEntry()]), sourceOf).blocking.length, 1);
  // A scan of a few paths does not call the other entries stale.
  assert.equal(evaluateSast({ results: [], errors: [] }, list([sastEntry()]), sourceOf, { fullScan: false }).stale.length, 0);
});

test('CICD-02@PoC FR 14 «Вразливості залежностей»: High and Critical in production dependencies block; Moderate is only reported', () => {
  const r = evaluateSca(audit(advisory('GHSA-aaaa-bbbb-cccc', 'pg', 'high', '8.0.0'), advisory('GHSA-cccc-dddd-ffff', 'zod', 'critical', '4.0.0'), advisory('GHSA-g3hv-75wg-m249', 'minimatch', 'moderate', '9.0.5')), list());
  assert.deepEqual(r.blocking.map((f) => f.package), ['pg', 'zod']);
  assert.equal(r.reported.length, 1);
  const s = summarize('sca', r, []);
  assert.equal(s.ok, false);
  assert.match(s.annotations[0], /^::error title=GHSA-aaaa-bbbb-cccc \(high\)::pg@8\.0\.0/);
  assert.equal(summarize('sca', evaluateSca(audit(), list()), []).ok, true);
});

test('CICD-02@PoC FR 14 «Вразливості залежностей»: output that is not an audit report (registry down, error) fails closed', () => {
  for (const bad of [null, {}, { error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE', message: 'down' } }]) {
    assert.equal(summarize('sca', evaluateSca(bad, list()), []).ok, false);
  }
});

test('CICD-02@PoC FR 14 «Вразливості залежностей»: an exception needs the owner and a review date', () => {
  assert.deepEqual(validateAllowlist(list([], [scaEntry()]), TODAY), []);
  assert.match(validateAllowlist(list([], [scaEntry({ decision: LEAD })]), TODAY).join('\n'), /needs the owner's decision/);
  assert.match(validateAllowlist(list([], [scaEntry({ kind: 'false-positive' })]), TODAY).join('\n'), /never a false positive/);
  assert.match(validateAllowlist(list([], [scaEntry({ owner: '' })]), TODAY).join('\n'), /"owner" is required/);
  assert.match(validateAllowlist(list([], [scaEntry({ review_by: undefined })]), TODAY).join('\n'), /"review_by" is required/);
  assert.match(validateAllowlist(list([], [scaEntry({ review_by: '27.02.2027' })]), TODAY).join('\n'), /YYYY-MM-DD/);
  assert.match(validateAllowlist(list([], [scaEntry({ review_by: '2028-01-01' })]), TODAY).join('\n'), /more than 366 days/);
  assert.match(validateAllowlist(list([], [scaEntry({ advisory: 'CVE-2026-1' })]), TODAY).join('\n'), /GHSA id/);
  assert.match(validateAllowlist(list([sastEntry({ reason: ' ' })]), TODAY).join('\n'), /"reason" is required/);
  assert.match(validateAllowlist(list([sastEntry({ decision: 'ok' })]), TODAY).join('\n'), /"decision" must start/);
  assert.match(validateAllowlist(list([sastEntry({ kind: 'accepted-risk' })]), TODAY).join('\n'), /needs the owner's decision/);
  assert.deepEqual(validateAllowlist(list([sastEntry({ kind: 'accepted-risk', decision: OWNER })]), TODAY), []);
  assert.match(validateAllowlist({ sast: [] }, TODAY).join('\n'), /expected/);
  // An accepted advisory passes; the allowlist problems themselves fail the job.
  const r = evaluateSca(audit(advisory('GHSA-g3hv-75wg-m249', 'minimatch', 'high', '9.0.5')), list([], [scaEntry()]));
  assert.equal(r.blocking.length, 0);
  assert.equal(summarize('sca', r, []).ok, true);
  assert.equal(summarize('sca', r, ['allowlist sca[0]: "owner" is required']).ok, false);
});

test('NFR-01@PoC AC2: an accepted risk past its review date without a new decision is open again and blocks', () => {
  const expired = list([sastEntry({ review_by: '2026-11-26' })], [scaEntry({ review_by: '2026-11-26' })]);
  const problems = validateAllowlist(expired, TODAY);
  assert.equal(problems.length, 2);
  for (const p of problems) assert.match(p, /review date 2026-11-26 has passed — the finding is open again \(NFR-01 AC2\)/);
  assert.equal(summarize('sca', evaluateSca(audit(), list()), problems).ok, false);
  // The review day itself is still valid.
  assert.deepEqual(validateAllowlist(list([sastEntry({ review_by: TODAY })]), TODAY), []);
});

test('NFR-01@PoC EC1: an exception holds only for the exact versions accepted — an updated dependency is checked again', () => {
  const entry = scaEntry({ versions: ['9.0.5'] });
  assert.equal(evaluateSca(audit(advisory('GHSA-g3hv-75wg-m249', 'minimatch', 'high', '9.0.5')), list([], [entry])).blocking.length, 0);
  const updated = evaluateSca(audit(advisory('GHSA-g3hv-75wg-m249', 'minimatch', 'high', '9.0.6')), list([], [entry]));
  assert.equal(updated.blocking.length, 1);
  assert.equal(updated.stale.length, 1);
  assert.equal(summarize('sca', updated, []).ok, false);
  assert.match(validateAllowlist(list([], [scaEntry({ versions: [] })]), TODAY).join('\n'), /exact versions/);
});

test('NFR-01@PoC criterion «Вразливості»: the committed allowlist is valid, every entry has a reason, owner, decision and review date', () => {
  const committed = JSON.parse(readFileSync(new URL('../allowlist.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateAllowlist(committed, TODAY), []);
});
