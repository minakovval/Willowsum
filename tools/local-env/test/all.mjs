// Entry for `node --test tools/local-env`: Node runs the directory through package.json "main",
// so this file loads every *.test.mjs next to it (unit tests only; no Docker needed).
// The smoke test against a running stack is smoke.it.mjs: `pnpm local:smoke`.
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.test.mjs')).sort()) {
  await import(new URL(name, dir));
}
