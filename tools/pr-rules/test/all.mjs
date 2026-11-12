// Entry for `node --test tools/pr-rules`: loads every *.test.mjs next to it.
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.test.mjs')).sort()) {
  await import(new URL(name, dir));
}
