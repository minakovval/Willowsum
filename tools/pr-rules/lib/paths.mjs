// CICD-01 FR 4 (ADR-0008): which changed files make a PR sensitive, and which make it act on the cloud or
// production (FR 3: needs the owner's approval comment). One map, used by the PR label job and by the
// daily check, so both always agree.

/**
 * Glob → RegExp. `**` matches any number of path segments (also none), `*` anything inside one segment. A
 * trailing `/**` also matches the folder path itself (a symlink put in place of the folder). Any character,
 * a newline too, can be in a file name.
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '/' && glob.slice(i) === '/**') {
      re += '(?:/.*)?';
      break;
    }
    if (c === '*' && glob[i + 1] === '*') {
      // `**/` (or a trailing `**`) spans whole segments.
      if (glob[i + 2] === '/') {
        re += '(?:[^/]+/)*';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 's');
}

const MONEY_MODULES = [
  'accounts', 'transactions', 'ledger', 'fx-rates', 'net-worth', 'valuation', 'auto-valuation', 'holdings',
  'cost-basis', 'broker-events', 'crypto', 'liabilities', 'budget', 'cashflow', 'goals', 'debt-payoff',
  'billing', 'recurring', 'transfer-matching', 'duplicate-matching', 'usage-limits',
];

/**
 * Sensitive categories of CICD-01 FR 4 → path globs. A file in any of them makes the PR sensitive: it gets the
 * label `sensitive` (plus `sensitive:<category>`) and needs a security review with «Security verdict: Ready».
 */
export const SENSITIVE_PATHS = {
  auth: [
    'apps/api/src/modules/identity/**',
    '**/auth/**',
    'apps/api/src/platform/http/cookies.ts',
    'apps/api/src/platform/http/origin.ts',
    'apps/api/src/platform/http/rate-limit.ts',
  ],
  permissions: [
    'apps/api/src/modules/access-scope/**',
    'apps/api/src/modules/household/**',
    'apps/api/src/modules/plan-catalog/**',
    'apps/api/src/modules/staff-admin/**',
    'apps/api/src/modules/vault-sharing/**',
    'apps/api/src/modules/vault-emergency-access/**',
    'apps/api/src/platform/http/**',
    'apps/api/src/api.ts',
    'apps/api/src/main.ts', // rate limits on/off, allowed origins
    'apps/api/src/platform/process/**', // security headers
    'apps/api/src/platform/config/**', // secrets and security switches
    'apps/api/module-rules.json',
  ],
  encryption: [
    'apps/api/src/modules/vault-items/**',
    'apps/api/src/modules/file-storage/**',
    // `crypt` covers encrypt, decrypt, crypto and vault-crypto (the `crypto` money module too: harmless).
    '**/*crypt*',
    '**/*cipher*',
    '**/*kms*',
    '**/*crypt*/**',
    '**/*cipher*/**',
    '**/*kms*/**',
  ],
  money: [
    'packages/domain-kernel/**',
    ...MONEY_MODULES.map((m) => `apps/api/src/modules/${m}/**`),
  ],
  schema: [
    '**/migrations/**',
    'apps/api/src/platform/db/**',
    'apps/api/schema-exemptions.json',
    'apps/api/scripts/check-schema.ts',
    'apps/api/scripts/check-migrations.ts',
    'apps/api/scripts/migrate.ts',
    'apps/api/scripts/db-bootstrap.ts',
    'apps/api/scripts/lib/migration-compat.ts',
  ],
  pipeline: [
    '.github/**',
    '**/Dockerfile',
    '**/Dockerfile.*',
    '**/dockerfile',
    '**/*.dockerfile',
    '**/*.Dockerfile',
    '**/Containerfile*',
    '.dockerignore',
    // Supply chain: the scripts CI runs, the workspace, the registry and the locked dependency tree.
    'package.json',
    '**/package.json', // each workspace package defines the gate commands its CI job runs
    '**/tsconfig*.json', // the strictness of the typecheck gate
    'packages/api-contract/scripts/**', // `contract:check`
    'packages/*/scripts/**', // package build and check scripts (e.g. the `pnpm build` gate)
    '**/vite.config.*', // Vitest falls back to it when a package has no vitest config
    '**/.prettierrc*', // Prettier takes the nearest config of each file
    '**/prettier.config.*',
    '.prettierignore',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    '.npmrc',
    '.gitleaksignore',
    '.gitleaks.toml',
    // Everything the required CI jobs run as a gate.
    'tools/pr-rules/**',
    'tools/req-check/**',
    'tools/test-guards/**',
    'tools/local-env/**',
    'tools/infra-check/**',
    'tools/observability/**',
    'apps/api/scripts/**',
    '!apps/api/scripts/**/*.test.ts', // a test of a gate script is not itself a gate
    'apps/api/provider-sdks.json',
    '**/eslint.config.*', // ESLint 10 takes the nearest config of each linted file: a nested one replaces the root rules
    '**/vitest*.config.*',
    // Claude Code settings: hooks run commands in every agent session.
    '.claude/settings*.json',
  ],
  infrastructure: ['infra/**', 'tools/infra-check/**', 'tools/observability/**'],
};

/**
 * Rule and requirement files (CICD-01 FR 3, AGENTS.md step 7): a PR that changes them is merged only when its
 * body records the owner's decision it implements. They get the label `owner-decision` (not `sensitive`).
 * `docs/plans/**` is left out: plans are the lead's working notes, not rules or requirements.
 */
export const OWNER_DECISION_PATHS = ['AGENTS.md', 'CLAUDE.md', '.claude/**', 'docs/requirements/**'];
export const OWNER_DECISION_LABEL = 'owner-decision';

/** Compile a glob list; entries starting with `!` exclude what the others match. */
function matcher(globs) {
  const include = globs.filter((g) => !g.startsWith('!')).map(globToRegExp);
  const exclude = globs.filter((g) => g.startsWith('!')).map((g) => globToRegExp(g.slice(1)));
  return (path) => include.some((re) => re.test(path)) && !exclude.some((re) => re.test(path));
}

const COMPILED = Object.entries(SENSITIVE_PATHS).map(([category, globs]) => [category, matcher(globs)]);
const OWNER_DECISION = matcher(OWNER_DECISION_PATHS);

/** Both names of every changed file (a rename is classified by where it came from and where it went). */
export const changedPaths = (files) => files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));

/** File names are attacker-chosen: no control characters, no `::` and no legacy `##[` workflow commands in logs. */
export const safeName = (text) =>
  String(text).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '?').replace(/::/g, ': :').replace(/##\[/g, '# #[');

/** Documentation (Markdown, also the PR template) changes no behaviour, so it is never sensitive by itself. */
const isDoc = (path) => /\.md$/i.test(path);

/** The sensitive categories of one path (empty when the path is not sensitive). */
export function categoriesOf(path) {
  if (isDoc(path)) return [];
  return COMPILED.filter(([, matches]) => matches(path)).map(([category]) => category);
}

/** A requirement-file diff that only rewrites the «Перевіряється» line (test paths) is no requirement change. */
const onlyTestPathsLine = (patch) =>
  Boolean(patch) &&
  patch
    .split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(?:\+\+\+|---) /.test(l))
    .every((l) => /^[+-]- Перевіряється:/.test(l));

/**
 * Changed rule or requirement files that need a recorded owner decision. `files`: `{ filename,
 * previous_filename?, patch? }`; a requirement file whose patch only touches «Перевіряється» does not count.
 */
export function ownerDecisionFiles(files) {
  const out = [];
  for (const f of files) {
    const names = [f.filename, f.previous_filename].filter(Boolean).filter(OWNER_DECISION);
    if (!names.length) continue;
    if (names.every((n) => n.startsWith('docs/requirements/')) && !f.previous_filename && onlyTestPathsLine(f.patch)) continue;
    out.push(...names);
  }
  return [...new Set(out)];
}

/**
 * Classify a PR by its changed paths (for a renamed file pass both names). `truncated`: the API listed fewer
 * files than the PR changes (it stops at 3000), so the unlisted files are taken as sensitive.
 * @returns {{ sensitive: boolean, categories: string[], files: Record<string, string[]> }}
 */
export function classifyPaths(paths, { truncated = false } = {}) {
  const files = {};
  for (const path of paths) {
    for (const category of categoriesOf(path)) (files[category] ??= []).push(path);
  }
  const categories = Object.keys(SENSITIVE_PATHS).filter((c) => files[c]);
  if (truncated) {
    files.unlisted = ['(files beyond the API limit)'];
    categories.push('unlisted');
  }
  return { sensitive: categories.length > 0, categories, files };
}

/** Classify changed files (`{ filename, previous_filename? }`) by both names. */
export const classifyFiles = (files, opts) => classifyPaths(changedPaths(files), opts);

/** Union of two classifications (a PR that edits this map is judged by the old and the new one). */
export function unionClassification(a, b) {
  if (!b) return a;
  const files = { ...a.files };
  for (const [c, list] of Object.entries(b.files ?? {})) files[c] = [...new Set([...(files[c] ?? []), ...list])];
  const order = [...Object.keys(SENSITIVE_PATHS), 'unlisted'];
  const categories = order.filter((c) => a.categories.includes(c) || b.categories.includes(c));
  return { sensitive: categories.length > 0, categories, files };
}

/** Labels for a classification: `sensitive` and one `sensitive:<category>` per category. */
export function labelsFor(classification) {
  if (!classification.sensitive) return [];
  return ['sensitive', ...classification.categories.map((c) => `sensitive:${c}`)];
}

// ---------------------------------------------------------------------------------------------------------
// Cloud or production (CICD-01 FR 3, AGENTS.md step 7): applying infrastructure, deploying or releasing to
// production, the workflows that do this and their trust settings (OIDC, the production secrets store), and
// production DNS. Infrastructure code that is only validated, CI check jobs and the local environment are not.

/** A workflow acts on the cloud or production when its text has one of these. */
const WORKFLOW_SIGNALS = [
  [/\bid-token:\s*write\b/, 'requests an OIDC token (id-token: write)'],
  [/\b(?:tofu|terraform)\s+(?:-chdir=\S+\s+)?apply\b/, 'applies infrastructure'],
  // Environment names and expression contexts are case-insensitive in GitHub Actions.
  [/^[+\- ]?\s*environment:\s*['"]?production\b/im, 'uses the production environment'],
  [/^[+\- ]?\s*environment:\s*\{[^}\n]*\bname:\s*['"]?production\b/im, 'uses the production environment'],
  [productionEnvironmentBlock, 'uses the production environment'],
  [/\b(?:docker|podman)\s+push\b|\bcosign\s+sign\b/, 'publishes or signs an image'],
  [pushingBuildAction, 'publishes an image (docker/build-push-action with push: true)'],
  [usesSecret, 'uses a secret other than GITHUB_TOKEN'],
];

/** `environment:` as a block whose `name:` (in any position) is production. */
function productionEnvironmentBlock(text) {
  const lines = text.split('\n').map((l) => l.replace(/^[+-]/, '')); // diff lines too
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)environment:\s*(?:#.*)?$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim() || /^\s*#/.test(lines[j])) continue;
      if (/^(\s*)/.exec(lines[j])[1].length <= m[1].length) break;
      if (/^\s*name:\s*['"]?production\b/i.test(lines[j])) return true;
    }
  }
  return false;
}

/**
 * The `secrets` context in any expression (`secrets.X`, `secrets['X']`, `toJSON(secrets)`, any letter case) other
 * than the job token, or `secrets: inherit`.
 */
function usesSecret(text) {
  if (/^[+\- ]?\s*secrets:\s*['"]?inherit\b/m.test(text)) return true;
  for (const [, expr] of text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    if (/\bsecrets\b(?!\s*\.\s*GITHUB_TOKEN\b)/i.test(expr.replace(/'(?:[^']|'')*'/g, "''"))) return true;
  }
  return false;
}

/** docker/build-push-action (or a fork of it) with `push:` true or an expression. */
function pushingBuildAction(text) {
  return /\buses:\s*['"]?[\w.-]+\/build-push-action@/.test(text) && /^[+\- ]?\s*push:\s*['"]?(?:true|\$\{\{)/m.test(text);
}
const signal = (re, text) => (typeof re === 'function' ? re(text) : re.test(text));
/** A workflow file whose name says it deploys, releases, applies or promotes. */
const WORKFLOW_NAME = /^\.github\/workflows\/[^/]*(?:deploy|release|apply|promote|production)[^/]*\.ya?ml$/i;

/** Infrastructure text about OIDC trust, the production secrets store or DNS records. */
const INFRA_SIGNALS = [
  [/\boidc\b|identity_provider|workload_identity|identity_domains?|token_exchange/i, 'OIDC trust'],
  [/\boci_vault_secret\b|\bsecrets?[-_]store\b/i, 'production secrets store'],
  [/\boci_dns_|\bcloudflare_(?:record|dns|zone)|\bdns_(?:record|zone)\b/i, 'DNS'],
];
const INFRA_NAME = /^infra\/(?!local\/)(?:[^/]+\/)*[^/]*(?:oidc|dns|secrets?-store|deploy)[^/]*$/i;

/** Drop comment lines (`#`, `//`, also as diff lines `+# …`) so a remark about OIDC is not a change of it. */
function withoutComments(text) {
  return text
    .split('\n')
    .filter((line) => !/^[+\- ]?\s*(?:#|\/\/)/.test(line))
    .join('\n');
}

/**
 * Does a PR act on the cloud or production? `files`: `{ filename, previous_filename?, patch?, content?,
 * unreadable? }` where `content` is the full text of a changed workflow (the patch shows only the changed
 * lines) and `unreadable` marks a change GitHub did not return (a large diff): it fails closed.
 * `truncated`: the file list itself is incomplete.
 * @returns {{ required: boolean, reasons: string[] }}
 */
export function ownerApprovalNeeded(files, { truncated = false } = {}) {
  const reasons = truncated ? ['more files than the API lists: not all changes could be read'] : [];
  for (const f of files) {
    const names = [f.filename, f.previous_filename].filter(Boolean);
    const text = [f.patch, f.content].filter(Boolean).join('\n');
    for (const name of names) {
      if (name.startsWith('.github/workflows/')) {
        if (f.unreadable && !text) reasons.push(`${name}: the change could not be read`);
        if (WORKFLOW_NAME.test(name)) reasons.push(`${name}: a deploy/release/apply workflow`);
        for (const [re, why] of WORKFLOW_SIGNALS) if (signal(re, text)) reasons.push(`${name}: ${why}`);
      } else if (name.startsWith('infra/') && !name.startsWith('infra/local/')) {
        if (INFRA_NAME.test(name)) reasons.push(`${name}: an OIDC, DNS, secrets-store or deploy file`);
        if (/\.md$/i.test(name)) continue; // documentation does not change the cloud
        if (f.unreadable && !text) reasons.push(`${name}: the change could not be read`);
        const code = withoutComments(text);
        for (const [re, why] of INFRA_SIGNALS) if (re.test(code)) reasons.push(`${name}: ${why}`);
      }
    }
  }
  const unique = [...new Set(reasons)];
  return { required: unique.length > 0, reasons: unique };
}
