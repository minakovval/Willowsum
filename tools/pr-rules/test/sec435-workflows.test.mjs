import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobNames } from '../lib/workflows.mjs';

// Security review of #435 (#243 item 2): mutation survivors of `comparesToSuccess`. A matrix job that is wrongly
// «covered» leaves the required list, so its red parts would no longer stop a merge or show in the daily check.
const matrix = (key) => [`  ${key}:`, '    name: p ${{ matrix.x }}'];
const wf = (...jobs) => ['jobs:', ...jobs.flat(), ''].join('\n');
const listed = (yml) => jobNames(yml).includes('parts');

test('sec435: the variable tested must be the one bound to needs.<key>.result', () => {
  const agg = ['  agg:', '    needs: [parts]', '    steps:', '      - env:', '          PARTS: ${{ needs.parts.result }}', '          OTHER: success', '        run: |', '          test "$OTHER" = "success"'];
  assert.equal(listed(wf(matrix('parts'), agg)), true);
});

test('sec435: a comparison with another value than success does not cover', () => {
  for (const line of ['test "$PARTS" = "skipped"', '[ "$PARTS" = failure ]', 'test "$PARTS" != "success"']) {
    const agg = ['  agg:', '    needs: [parts]', '    steps:', '      - env:', '          PARTS: ${{ needs.parts.result }}', '        run: |', `          ${line}`];
    assert.equal(listed(wf(matrix('parts'), agg)), true, line);
  }
  for (const cond of ["needs.parts.result == 'failure'", "needs.parts.result != 'success'", "needs.parts.result == 'skipped'"])
    assert.equal(listed(wf(matrix('parts'), ['  agg:', '    needs: parts', `    if: ${cond}`])), true, cond);
});

test('sec435: a job that reads needs.<key>.result without needing the job does not cover it', () => {
  assert.equal(listed(wf(matrix('parts'), ['  agg:', '    needs: [changes]', "    if: needs.parts.result == 'success'"])), true);
});

test('sec435: a key with a hyphen or one that is a prefix of another is matched whole', () => {
  const agg = ['  agg:', '    needs: [api-parts, api]', '    steps:', '      - env:', '          PARTS: ${{ needs.api-parts.result }}', '        run: |', '          test "$PARTS" = "success"'];
  const names = jobNames(wf(matrix('api-parts'), matrix('api'), agg));
  assert.deepEqual(names, ['api', 'agg']);
});

// #452: a step-level `if:`, `continue-on-error` or an `always()` / `||` condition makes the comparison decide nothing.
test('#452: a skipped or ignored comparison does not cover a matrix job', () => {
  const step = (extra) => ['  agg:', '    needs: [parts]', '    steps:', '      - env:', '          PARTS: ${{ needs.parts.result }}', ...extra, '        run: |', '          test "$PARTS" = "success"'];
  assert.equal(listed(wf(matrix('parts'), step([]))), false);
  assert.equal(listed(wf(matrix('parts'), step(["        if: needs.parts.result != 'x'"]))), true);
  assert.equal(listed(wf(matrix('parts'), step(['        continue-on-error: true']))), true);
  assert.equal(listed(wf(matrix('parts'), ['  agg:', '    needs: [parts]', '    continue-on-error: true', "    if: needs.parts.result == 'success'"])), true);
  for (const cond of ["needs.parts.result == 'success' || always()", "always() && needs.parts.result == 'success'", "needs.parts.result == 'success' || needs.x.result == 'success'"])
    assert.equal(listed(wf(matrix('parts'), ['  agg:', '    needs: [parts]', `    if: ${cond}`])), true, cond);
  assert.equal(listed(wf(matrix('parts'), ['  agg:', '    needs: [parts]', "    if: needs.parts.result == 'success' && github.event_name == 'push'"])), false);
});
