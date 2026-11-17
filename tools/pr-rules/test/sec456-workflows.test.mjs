import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobNames } from '../lib/workflows.mjs';

// Security review of #456: mutation survivors of the #452 rule in `comparesToSuccess` (the step-level forms).
const matrix = ['  parts:', '    name: p ${{ matrix.x }}'];
const listed = (agg) => jobNames(['jobs:', ...matrix, ...agg, ''].join('\n')).includes('parts');
const tail = ['        env:', '          PARTS: ${{ needs.parts.result }}', '        run: |', '          test "$PARTS" = "success"'];

test('sec456: `if:` or `continue-on-error:` as the first key of a step (`- if:`) does not cover', () => {
  assert.equal(listed(['  agg:', '    needs: [parts]', '    steps:', '      - name: gate', ...tail]), false);
  assert.equal(listed(['  agg:', '    needs: [parts]', '    steps:', '      - if: false', ...tail]), true);
  assert.equal(listed(['  agg:', '    needs: [parts]', '    steps:', '      - continue-on-error: true', ...tail]), true);
});
