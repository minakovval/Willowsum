import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/platform/db/migrate.ts";
import { createTestDatabase } from "./db.ts";
import { realModulesDir } from "./real-modules.ts";

/**
 * ACC-04@PoC FR 4 (owner decision 2026-11-14: a device is the browser and the system without versions): migration
 * 0007 keeps the device history of the previous release (SHA-256 of the whole user agent) as scheme 1, which sign-in
 * still recognises, and converts at once what it can name — a device a «Це був не я» link names by browser and
 * system. Applied in two steps (0001–0006, synthetic rows, then 0007) on a throw-away database.
 */
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest();
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let dir: string;

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  dir = mkdtempSync(path.join(tmpdir(), "ws-identity-0007-"));
});

afterAll(async () => {
  await owner?.end();
  await db?.drop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("ACC-04@PoC FR 4: the device history before the browser-and-system rule gives no extra letters", () => {
  it("0007 marks the old rows scheme 1 and adds the browser-and-system key of a device a «Це був не я» link names", async () => {
    const source = path.join(realModulesDir, "identity/adapters/db/migrations");
    const target = path.join(dir, "identity/adapters/db/migrations");
    mkdirSync(target, { recursive: true });
    const files = readdirSync(source)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.at(6)).toMatch(/^0007_device_browser_os/);
    for (const file of files.slice(0, 6)) cpSync(path.join(source, file), path.join(target, file));
    await migrate(owner, { modules: ["identity"], modulesDir: dir });

    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO identity.accounts (email, email_normalized, display_name, password_hash, email_confirmed_at)
       VALUES ('migration@example.test', 'migration@example.test', 'Олена Міграційна', '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic', now()) RETURNING id`,
    );
    const id = rows[0]!.id;
    for (const ua of [CHROME_WINDOWS, FIREFOX_LINUX])
      await owner.query(
        `INSERT INTO identity.sign_in_devices (account_id, device_digest, first_seen_at, last_seen_at)
         VALUES ($1, $2, '2026-11-10Z', '2026-11-12Z')`,
        [id, sha(`device:${ua}`)],
      );
    // Firefox/Linux signed in from a new device: its link names it.
    await owner.query(
      `INSERT INTO identity.not_me_links (account_id, token_digest, device_digest, signed_in_at, device_browser,
                                          device_os, address_masked, created_at, expires_at)
       VALUES ($1, $2, $3, '2026-11-12Z', 'firefox', 'linux', '198.51.•••.77', '2026-11-12Z', '2026-11-19Z')`,
      [id, sha("synthetic token"), sha(`device:${FIREFOX_LINUX}`)],
    );

    cpSync(path.join(source, files[6]!), path.join(target, files[6]!));
    const result = await migrate(owner, { modules: ["identity"], modulesDir: dir });
    expect(result.applied).toEqual([expect.stringContaining("0007_device_browser_os")]);

    const after = await owner.query<{ digest: string; key_scheme: number; first_seen_at: Date }>(
      `SELECT encode(device_digest, 'hex') AS digest, key_scheme, first_seen_at
         FROM identity.sign_in_devices WHERE account_id = $1 ORDER BY key_scheme, digest`,
      [id],
    );
    expect(after.rows).toEqual(
      [
        { digest: sha(`device:${CHROME_WINDOWS}`).toString("hex"), key_scheme: 1 },
        { digest: sha(`device:${FIREFOX_LINUX}`).toString("hex"), key_scheme: 1 },
        { digest: sha("device:firefox/linux").toString("hex"), key_scheme: 2 },
      ]
        .sort((a, b) => a.key_scheme - b.key_scheme || a.digest.localeCompare(b.digest))
        .map((r) => ({ ...r, first_seen_at: new Date("2026-11-10Z") })),
    );
    // Applying it again changes nothing.
    expect((await migrate(owner, { modules: ["identity"], modulesDir: dir })).applied).toEqual([]);
  });
});
