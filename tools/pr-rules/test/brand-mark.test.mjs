// CMP-71@PoC AC5: the brand mark of the code is the mark of the design-system file. Lives here, not in
// packages/ui, because heavy jobs read nothing under design/ (ci-paths.test.mjs), and this job runs on every PR.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = new URL('../../../', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pathsOf = (svg) => [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);

test('CMP-71@PoC AC5: the mark assets of packages/ui draw the same paths as the design-system file', () => {
  for (const tone of ['light', 'dark', 'mono']) {
    const design = pathsOf(read(`design/design-system/assets/Logos/mark-${tone}.svg`));
    assert.equal(design.length, 3, tone);
    assert.deepEqual(pathsOf(read(`packages/ui/src/brand/assets/mark-${tone}.svg`)), design, tone);
  }
});
