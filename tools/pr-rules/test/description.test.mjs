import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { checkDescription, requirementIds, sections } from '../lib/description.mjs';

const ids = new Set(['CICD-01', 'BUD-03', 'DS-01', 'PRC-02', 'AST-14a']);
const template = fs.readFileSync(new URL('../../../.github/pull_request_template.md', import.meta.url), 'utf8');

const body = ({ criteria = '| Criterion | Test |\n| --- | --- |\n| FR 2 | `test/x.test.mjs` |', tested = '- [x] `node --test tools/pr-rules`', sensitive = '- [ ] Auth / … → needs security review' } = {}) =>
  [
    '## Requirement',
    '',
    '[docs/requirements/cicd/CICD-01.poc.md](docs/requirements/cicd/CICD-01.poc.md)',
    '',
    '## Acceptance criteria covered',
    '',
    criteria,
    '',
    '## How it was tested',
    '',
    tested,
    '',
    '## Sensitive areas touched',
    '',
    sensitive,
  ].join('\n');

const ok = (pr) => assert.deepEqual(checkDescription({ ids, ...pr }), []);
const fails = (pr, re) => {
  const problems = checkDescription({ ids, ...pr });
  assert.ok(problems.some((p) => re.test(p)), `expected ${re}, got ${JSON.stringify(problems)}`);
};

test('CICD-01 criterion 4: a PR without a requirement ID in the title is blocked', () => {
  fails({ title: 'Fix the build', body: body() }, /must start with a requirement ID/);
  fails({ title: 'cicd-01: lower case', body: body() }, /must start with a requirement ID/);
  fails({ title: 'CICD-01x', body: body() }, /must start with a requirement ID/);
});

test('CICD-01 FR 2: the ID must be a requirement that exists in docs/requirements', () => {
  fails({ title: 'BUD-99: no such requirement', body: body() }, /BUD-99, but docs\/requirements\/ has no file/);
  ok({ title: 'CICD-01: branches and PRs', body: body() });
  ok({ title: 'AST-14a: sub-requirement', body: body() });
  // Forms used by merged PRs: an issue after the ID, a list of IDs, process requirements.
  ok({ title: 'DS-01 (#32): states, amounts and statuses — one pattern each', body: body() });
  ok({ title: 'BUD-03, DS-01: two in one module', body: body() });
  ok({ title: 'PRC-02: owner decisions 2026-11-06', body: body() });
});

test('review #87 item 6: the title may name a release slice (`BUD-16@PoC: …`); the ID part must exist', () => {
  ok({ title: 'CICD-01@PoC: branches and PRs', body: body() });
  ok({ title: 'CICD-01@PoC v2: later slice', body: body() });
  ok({ title: 'CICD-01: plain ID', body: body() });
  fails({ title: 'BUD-99@PoC: no such requirement', body: body() }, /BUD-99, but docs\/requirements\/ has no file/);
  fails({ title: 'CICD-01@: empty release', body: body() }, /must start with a requirement ID/);
  fails({ title: 'CICD-01@PoC', body: body() }, /must start with a requirement ID/);
});

test('CICD-01 FR 2: the real requirement IDs are read from docs/requirements', () => {
  const real = requirementIds(new URL('../../../docs/requirements', import.meta.url).pathname);
  for (const id of ['CICD-01', 'PRC-02', 'DS-01', 'ARC-09', 'NFR-14']) assert.ok(real.has(id), id);
  assert.ok(!real.has('README'));
});

test('CICD-01 FR 2: the description has the template sections', () => {
  fails({ title: 'CICD-01: x', body: '' }, /no «## Requirement» section/);
  fails({ title: 'CICD-01: x', body: 'Just some text' }, /no «## Acceptance criteria covered» section/);
  fails({ title: 'CICD-01: x', body: body().replace('## How it was tested', '## Testing') }, /no «## How it was tested»/);
  fails({ title: 'CICD-01: x', body: body().replace('## Sensitive areas touched', '') }, /no «## Sensitive areas touched»/);
});

test('CICD-01 FR 2: the unfilled template is refused', () => {
  const problems = checkDescription({ ids, title: 'CICD-01: x', body: template });
  assert.ok(problems.some((p) => /«Requirement» is empty/.test(p)));
  assert.ok(problems.some((p) => /«Acceptance criteria covered» is empty/.test(p)));
  assert.ok(problems.some((p) => /«How it was tested» is empty or has only unticked/.test(p)));
});

test('CICD-01 FR 2: criteria are mapped to tests — a table needs at least one row', () => {
  fails({ title: 'CICD-01: x', body: body({ criteria: '| Criterion | Test |\n| --- | --- |' }) }, /table without rows/);
  fails({ title: 'CICD-01: x', body: body({ criteria: '<!-- fill me -->' }) }, /criteria covered» is empty/);
  // A documentation-only PR says why there are no tests (merged PRs #76, #79 do this).
  ok({ title: 'CICD-01: x', body: body({ criteria: 'No code; process text only. Checked on review.' }) });
  ok({ title: 'CICD-01: x', body: body({ criteria: '- FR 2 → `tools/pr-rules/test/description.test.mjs`' }) });
});

test('CICD-01 FR 2: «How it was tested» says what was run', () => {
  fails({ title: 'CICD-01: x', body: body({ tested: '- [ ] One automated test per acceptance criterion' }) }, /How it was tested/);
  ok({ title: 'CICD-01: x', body: body({ tested: '- [ ] Permission tests: n/a\n\n`pnpm test` green.' }) });
});

test('CICD-01 FR 4: a PR with sensitive files must tick «Sensitive areas touched»', () => {
  const sensitive = { sensitive: true, categories: ['pipeline'] };
  fails({ title: 'CICD-01: x', body: body(), sensitive }, /changes sensitive files \(pipeline\): tick/);
  ok({ title: 'CICD-01: x', body: body({ sensitive: '- [x] Auth / … → needs security review' }), sensitive });
  ok({ title: 'CICD-01: x', body: body(), sensitive: { sensitive: false, categories: [] } });
});

test('sections: headings inside code fences and HTML comments are ignored', () => {
  const s = sections('## A\n```\n## B\n```\n<!-- ## C -->\ntext\n## D\n');
  assert.deepEqual([...s.keys()], ['A', 'D']);
  assert.match(s.get('A'), /## B/);
});
