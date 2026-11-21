import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkObjectKey, checkPrefix, type ObjectStorage } from "./port.ts";

/**
 * Local-only implementation of the object storage port: objects as files in one directory of this machine, shared by
 * the api, worker and scheduler processes of `pnpm local:dev` when it runs without the S3 of `pnpm local:up` (no
 * Docker, `WS_TEST_PG_ADMIN_URL`). The configuration refuses `WS_FILES_DIR` in staging and production (config.ts), so a
 * deployed process never keeps files here. The objects are already encrypted with the space's key (file-storage).
 * Keys are lower-case ids joined by «/» (checkObjectKey), so a key never leaves the directory.
 */
export function directoryObjectStorage(root: string): ObjectStorage {
  if (!path.isAbsolute(root)) throw new Error("The files directory is an absolute path");
  const fileOf = (key: string) => path.join(root, ...key.split("/"));
  return {
    async put(key, body) {
      checkObjectKey(key);
      const file = fileOf(key);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      // A reader in another process sees the whole object or none: written aside, then renamed over the key.
      const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(tmp, body, { mode: 0o600, flag: "wx" });
      await rename(tmp, file);
    },
    async get(key) {
      checkObjectKey(key);
      try {
        return await readFile(fileOf(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      checkObjectKey(key);
      await rm(fileOf(key), { force: true });
    },
    async list(prefix) {
      checkPrefix(prefix);
      const keys: string[] = [];
      const walk = async (dir: string, at: string) => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
          throw error;
        }
        for (const e of entries) {
          const key = at ? `${at}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(path.join(dir, e.name), key);
          else if (e.isFile() && !e.name.endsWith(".tmp")) keys.push(key);
        }
      };
      await walk(root, "");
      return keys
        .filter((k) => k.startsWith(prefix))
        .sort()
        .slice(0, 1000);
    },
  };
}
