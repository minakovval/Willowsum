// Entry for `node --test tools/req-check`: Node runs the directory through package.json "main",
// so this file loads every *.test.mjs next to it. Do not name it *.test.mjs (it would run twice).
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.test.mjs')).sort()) {
  await import(new URL(name, dir));
}
