// NFR-07@PoC FR 1: are the browser release tables of the web app current? The supported minimum is computed from
// today's date over these tables (apps/web/src/browser/support.ts), so a table that stops getting new releases
// slowly goes wrong. Whether it is current depends on the date, not on a PR, so the daily check of main asks
// (owner decision 2026-11-17, #161), not the PR's CI: a stale table is reported in the alert issue.
import fs from 'node:fs';
import path from 'node:path';

/** The tables and their limits, shared with the web app. */
export const BROWSER_TABLES_FILE = 'apps/web/src/browser/releases.json';
const DAY = 24 * 3600 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read the tables for `evaluate` (lib/daily.mjs). A file that cannot be read is reported, not skipped. */
export function readBrowserTables(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, BROWSER_TABLES_FILE), 'utf8'));
  } catch (e) {
    return { error: String(e.message).slice(0, 200) };
  }
}

/**
 * Findings for the daily check: one per table whose newest release is older than its limit on `now`, and one
 * when the data cannot be judged (fail closed). `data` is the content of `BROWSER_TABLES_FILE`.
 * @returns {Array<{severity: string, requirement: string, rule: string, subject: string, message: string}>}
 */
export function browserTableFindings(data, now) {
  const finding = (subject, message) => ({ severity: 'stale', requirement: 'NFR-07@PoC', rule: 'FR 1', subject, message });
  const tables = data?.releases;
  if (data?.error || !tables || typeof tables !== 'object' || !Object.keys(tables).length) {
    return [finding('таблиці випусків браузерів', `не вдалося прочитати ${BROWSER_TABLES_FILE}: ${data?.error ?? 'немає таблиць'}`)];
  }
  const out = [];
  for (const [name, rows] of Object.entries(tables)) {
    const limit = data.staleAfterDays?.[name];
    const newest = Array.isArray(rows) ? rows.at(-1) : undefined;
    const [version, released] = Array.isArray(newest) ? newest : [];
    if (!Number.isInteger(limit) || limit <= 0 || typeof version !== 'string' || !ISO_DATE.test(released ?? '')) {
      out.push(finding(`таблиця випусків ${name}`, `немає строку свіжості або останнього випуску з датою у ${BROWSER_TABLES_FILE}`));
      continue;
    }
    const ageDays = Math.floor((new Date(now).getTime() - Date.parse(`${released}T00:00:00Z`)) / DAY);
    if (!(ageDays <= limit)) {
      out.push(
        finding(
          `таблиця випусків ${name}`,
          `найновіший випуск (${version}, ${released}) вийшов ${ageDays} дн. тому, більше за ${limit}: додайте новіші випуски з датами першого стабільного випуску в ${BROWSER_TABLES_FILE}`,
        ),
      );
    }
  }
  return out;
}
