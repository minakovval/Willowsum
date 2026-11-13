import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Scratch folders for tests that write files (module copies, migrations). They live inside apps/api so that
 * node_modules resolve; the folder is ignored by git.
 *
 * Unit and integration tests run at the same time from one checkout, so the shared parent is never removed:
 * each test gets its own folder from `makeTestTmpDir` and removes only that folder (`removeTestTmpDir`).
 * Removing the parent made a test delete another test's migrations between writing and running them.
 */
export const testTmpRoot = path.join(fileURLToPath(new URL("..", import.meta.url)), "test/.tmp");

/** A new, empty folder of its own under `test/.tmp`, named `<prefix>-XXXXXX`. */
export function makeTestTmpDir(prefix: string): string {
  mkdirSync(testTmpRoot, { recursive: true });
  return mkdtempSync(path.join(testTmpRoot, `${prefix}-`));
}

/** Removes one folder made by `makeTestTmpDir`; refuses the shared parent and anything outside it. */
export function removeTestTmpDir(dir: string): void {
  const relative = path.relative(testTmpRoot, path.resolve(dir));
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.includes(path.sep)
  )
    throw new Error(`removeTestTmpDir: ${dir} is not a folder made by makeTestTmpDir`);
  rmSync(dir, { recursive: true, force: true });
}
