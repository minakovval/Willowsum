// Blocking SAST (Semgrep) and SCA (pnpm audit) of every PR — CICD-02 criteria «Статичний аналіз безпеки коду» and
// «Вразливості залежностей», NFR-01 criterion «Вразливості» (owner decision 7, 2026-11-26). Pure functions: the
// CLI (index.mjs) runs the scanners and passes their JSON here. Zero dependencies.

/** Semgrep severities that block: High and Critical (rules.yml maps them to ERROR). */
export const BLOCKING_SEMGREP_SEVERITIES = new Set(['ERROR']);
/** pnpm audit severities that block in production dependencies. */
export const BLOCKING_AUDIT_SEVERITIES = new Set(['high', 'critical']);
/** The longest an allowlist entry may stay without a new review. */
export const MAX_REVIEW_DAYS = 366;

/** The shortest SAST `match`: enough code to name one line. */
export const MIN_MATCH_LENGTH = 16;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OWNER_DECISION = /^Рішення власника \(\d{4}-\d{2}-\d{2}\)/;
const LEAD_DECISION = /^Рішення ведучого \(\d{4}-\d{2}-\d{2}; власник не схвалював\)/;

/** `YYYY-MM-DD` of a Date in UTC. */
export const isoDay = (date) => date.toISOString().slice(0, 10);

/**
 * Checks the shape of the allowlist (tools/security-scan/allowlist.json). Every entry has a reason, an owner, a
 * decision and a review date within MAX_REVIEW_DAYS; an entry past its review date is open again and blocks
 * (NFR-01 AC2). An accepted risk (every SCA entry, and a SAST entry that is not a false positive) needs the product
 * owner's decision (CICD-02 «винятки — лише з власником і датою перегляду»).
 * @returns {string[]} problems, empty when the list is valid
 */
export function validateAllowlist(list, today) {
  const problems = [];
  if (!list || typeof list !== 'object' || !Array.isArray(list.sast) || !Array.isArray(list.sca)) {
    return ['allowlist: expected {"sast": [...], "sca": [...]}'];
  }
  const common = (e, where) => {
    for (const f of ['reason', 'owner', 'decision', 'review_by']) {
      if (typeof e[f] !== 'string' || e[f].trim() === '') problems.push(`${where}: "${f}" is required`);
    }
    if (typeof e.review_by === 'string' && DATE.test(e.review_by)) {
      const days = (Date.parse(`${e.review_by}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
      if (days < 0) problems.push(`${where}: review date ${e.review_by} has passed — the finding is open again (NFR-01 AC2); review it and set a new date or fix it`);
      if (days > MAX_REVIEW_DAYS) problems.push(`${where}: review date ${e.review_by} is more than ${MAX_REVIEW_DAYS} days away`);
    } else if (typeof e.review_by === 'string') problems.push(`${where}: "review_by" must be YYYY-MM-DD`);
    if (!['false-positive', 'accepted-risk'].includes(e.kind)) problems.push(`${where}: "kind" must be "false-positive" or "accepted-risk"`);
    if (typeof e.decision === 'string') {
      if (e.kind === 'accepted-risk' && !OWNER_DECISION.test(e.decision)) {
        problems.push(`${where}: an accepted risk needs the owner's decision ("Рішення власника (YYYY-MM-DD): …")`);
      }
      if (e.kind === 'false-positive' && !OWNER_DECISION.test(e.decision) && !LEAD_DECISION.test(e.decision)) {
        problems.push(`${where}: "decision" must start with "Рішення власника (YYYY-MM-DD)" or "Рішення ведучого (YYYY-MM-DD; власник не схвалював)"`);
      }
    }
  };
  list.sast.forEach((e, i) => {
    const where = `allowlist sast[${i}]`;
    for (const f of ['rule', 'path', 'match']) {
      if (typeof e[f] !== 'string' || e[f].trim() === '') problems.push(`${where}: "${f}" is required`);
    }
    // A short `match` (`${t}`) would accept any line of the file; it names one line of code.
    if (typeof e.match === 'string' && e.match.trim() !== '' && e.match.trim().length < MIN_MATCH_LENGTH) {
      problems.push(`${where}: "match" must be at least ${MIN_MATCH_LENGTH} characters of the flagged line`);
    }
    if (e.count !== undefined && !(Number.isInteger(e.count) && e.count >= 1)) problems.push(`${where}: "count" must be a whole number ≥ 1`);
    common(e, where);
  });
  list.sca.forEach((e, i) => {
    const where = `allowlist sca[${i}]`;
    if (typeof e.advisory !== 'string' || !/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/.test(e.advisory)) problems.push(`${where}: "advisory" must be a GHSA id`);
    if (typeof e.package !== 'string' || e.package.trim() === '') problems.push(`${where}: "package" is required`);
    if (!Array.isArray(e.versions) || e.versions.length === 0 || !e.versions.every((v) => typeof v === 'string' && v)) {
      problems.push(`${where}: "versions" must list the exact versions accepted — an updated dependency is checked again (NFR-01 EC1)`);
    }
    common(e, where);
    if (e.kind !== 'accepted-risk') problems.push(`${where}: a dependency vulnerability is an accepted risk, never a false positive`);
  });
  return problems;
}

/** The rule id without the config path prefix Semgrep adds (`tools.security-scan.semgrep.ws-eval` → `ws-eval`). */
const ruleId = (checkId) => checkId.split('.').pop();

/**
 * Decides the SAST result from Semgrep's `--json` output.
 * @param {object} report Semgrep JSON
 * @param {object} allowlist parsed allowlist.json
 * @param {(path: string, start: number, end: number) => string} sourceOf the source lines of a finding
 * @param {{ fullScan?: boolean }} [opts] fullScan: every entry must still match a finding (a stale entry fails)
 * @returns {{ blocking: object[], allowed: object[], reported: object[], stale: object[], errors: string[] }}
 */
export function evaluateSast(report, allowlist, sourceOf, { fullScan = true } = {}) {
  const errors = [];
  // A rule or config error means part of the scan did not run: fail closed. A partial parse of one file is a warning.
  for (const e of report.errors ?? []) {
    if (e.level === 'error') errors.push(`semgrep: ${e.message ?? JSON.stringify(e.type)}`);
  }
  const used = new Map();
  const blocking = [];
  const allowed = [];
  const reported = [];
  for (const r of report.results ?? []) {
    const finding = {
      rule: ruleId(r.check_id),
      path: r.path,
      line: r.start.line,
      severity: r.extra?.severity,
      securitySeverity: r.extra?.metadata?.['security-severity'],
      message: r.extra?.message,
      source: sourceOf(r.path, r.start.line, r.end.line),
    };
    if (!BLOCKING_SEMGREP_SEVERITIES.has(finding.severity)) {
      reported.push(finding);
      continue;
    }
    // An entry accepts exactly `count` findings (default 1): one more on its line, such as a new interpolation, blocks.
    const i = allowlist.sast.findIndex(
      (e) => e.rule === finding.rule && e.path === finding.path && finding.source.includes(e.match) && (used.get(e) ?? 0) < (e.count ?? 1),
    );
    if (i >= 0) {
      const e = allowlist.sast[i];
      used.set(e, (used.get(e) ?? 0) + 1);
      allowed.push({ ...finding, entry: e });
    } else blocking.push(finding);
  }
  const stale = fullScan ? allowlist.sast.filter((e) => (used.get(e) ?? 0) < (e.count ?? 1)) : [];
  return { blocking, allowed, reported, stale, errors };
}

/**
 * Decides the SCA result from `pnpm audit --prod --json`. High and Critical advisories block unless an accepted-risk
 * entry names the advisory, the package and the exact installed version.
 * @returns {{ blocking: object[], allowed: object[], reported: object[], stale: object[], errors: string[] }}
 */
export function evaluateSca(report, allowlist) {
  const errors = [];
  if (!report || typeof report !== 'object' || typeof report.advisories !== 'object' || report.advisories === null) {
    errors.push(`pnpm audit: unexpected output${report?.error ? ` (${report.error.code ?? ''} ${report.error.message ?? ''})` : ''}; the scan did not run`);
    return { blocking: [], allowed: [], reported: [], stale: [], errors };
  }
  const used = new Set();
  const blocking = [];
  const allowed = [];
  const reported = [];
  for (const a of Object.values(report.advisories)) {
    const versions = [...new Set((a.findings ?? []).map((f) => f.version))];
    const paths = (a.findings ?? []).flatMap((f) => f.paths ?? []);
    const finding = {
      advisory: a.github_advisory_id,
      package: a.module_name,
      severity: a.severity,
      title: a.title,
      url: a.url,
      versions,
      paths,
    };
    if (!BLOCKING_AUDIT_SEVERITIES.has(a.severity)) {
      reported.push(finding);
      continue;
    }
    const i = allowlist.sca.findIndex(
      (e) => e.advisory === finding.advisory && e.package === finding.package && versions.length > 0 && versions.every((v) => e.versions.includes(v)),
    );
    if (i >= 0) {
      used.add(i);
      allowed.push({ ...finding, entry: allowlist.sca[i] });
    } else blocking.push(finding);
  }
  const stale = allowlist.sca.filter((_, i) => !used.has(i));
  return { blocking, allowed, reported, stale, errors };
}

/** Human-readable lines and GitHub annotations of a result; `ok` is false when the PR must be blocked. */
export function summarize(kind, result, allowlistProblems) {
  const lines = [];
  const annotations = [];
  for (const p of allowlistProblems) annotations.push(`::error file=tools/security-scan/allowlist.json::${p}`);
  for (const e of result.errors) annotations.push(`::error::${e}`);
  if (kind === 'sast') {
    for (const f of result.blocking) {
      annotations.push(`::error file=${f.path},line=${f.line},title=${f.rule} (${f.securitySeverity ?? 'High'})::${f.message}`);
    }
    for (const f of result.reported) lines.push(`medium/low (not blocking): ${f.rule} ${f.path}:${f.line}`);
    for (const f of result.allowed) lines.push(`allowlisted until ${f.entry.review_by}: ${f.rule} ${f.path}:${f.line} — ${f.entry.reason}`);
    for (const e of result.stale) annotations.push(`::error file=tools/security-scan/allowlist.json::stale SAST entry (no finding matches it any more; remove it): ${e.rule} ${e.path} «${e.match}»`);
  } else {
    for (const f of result.blocking) {
      annotations.push(`::error title=${f.advisory} (${f.severity})::${f.package}@${f.versions.join(', ')} — ${f.title} ${f.url} (path: ${f.paths.slice(0, 3).join('; ')})`);
    }
    for (const f of result.reported) lines.push(`moderate/low (not blocking): ${f.advisory} ${f.package}@${f.versions.join(', ')}`);
    for (const f of result.allowed) lines.push(`accepted until ${f.entry.review_by}: ${f.advisory} ${f.package} — ${f.entry.reason}`);
    for (const e of result.stale) annotations.push(`::error file=tools/security-scan/allowlist.json::stale SCA entry (the advisory or version is gone; remove it): ${e.advisory} ${e.package}`);
  }
  const ok = annotations.length === 0;
  lines.push(
    `${kind.toUpperCase()}: ${result.blocking.length} blocking, ${result.allowed.length} allowlisted, ${result.reported.length} below High — ${ok ? 'passed' : 'FAILED'}`,
  );
  return { ok, lines, annotations };
}
