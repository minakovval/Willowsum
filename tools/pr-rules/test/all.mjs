// Entry for `node --test tools/pr-rules`: loads every *.test.mjs next to it.
import fs from 'node:fs';

// #503: the GitHub client retries transient failures with backoff; in tests a 1 ms backoff.
process.env.PR_RULES_RETRY_MS ??= '1';

const dir = new URL('./', import.meta.url);
for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.test.mjs')).sort()) {
  await import(new URL(name, dir));
}
