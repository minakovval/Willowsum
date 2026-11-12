// CICD-01 FR 4 (ADR-0008): which changed files make a PR sensitive, and which make it act on the cloud or
// production (FR 3: needs the owner's approval comment). One map, used by the PR label job and by the
// daily check, so both always agree.

/** Glob → RegExp. `**` matches any number of path segments (also none), `*` anything inside one segment. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
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
  return new RegExp(`^${re}$`);
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
    'apps/api/module-rules.json',
  ],
  encryption: [
    'apps/api/src/modules/vault-items/**',
    'apps/api/src/modules/file-storage/**',
    '**/*encrypt*',
    '**/*cipher*',
    '**/*kms*',
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
    '.dockerignore',
    '.gitleaksignore',
    '.gitleaks.toml',
    'tools/pr-rules/**',
  ],
  infrastructure: ['infra/**', 'tools/infra-check/**', 'tools/observability/**'],
};

const COMPILED = Object.entries(SENSITIVE_PATHS).map(([category, globs]) => [category, globs.map(globToRegExp)]);

/** Documentation (Markdown, also the PR template) changes no behaviour, so it is never sensitive by itself. */
const isDoc = (path) => /\.md$/i.test(path);

/** The sensitive categories of one path (empty when the path is not sensitive). */
export function categoriesOf(path) {
  if (isDoc(path)) return [];
  return COMPILED.filter(([, res]) => res.some((re) => re.test(path))).map(([category]) => category);
}

/**
 * Classify a PR by its changed paths (for a renamed file pass both names).
 * @returns {{ sensitive: boolean, categories: string[], files: Record<string, string[]> }}
 */
export function classifyPaths(paths) {
  const files = {};
  for (const path of paths) {
    for (const category of categoriesOf(path)) (files[category] ??= []).push(path);
  }
  const categories = Object.keys(SENSITIVE_PATHS).filter((c) => files[c]);
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
  [/^\s*environment:\s*['"]?production\b/m, 'uses the production environment'],
  [/^\s*environment:\s*\n\s*name:\s*['"]?production\b/m, 'uses the production environment'],
  [/\b(?:docker|podman)\s+push\b|\bcosign\s+sign\b/, 'publishes or signs an image'],
];
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
 * Does a PR act on the cloud or production? `files`: `{ filename, previous_filename?, patch?, content? }` where
 * `content` is the full text of a changed workflow (the patch shows only the changed lines).
 * @returns {{ required: boolean, reasons: string[] }}
 */
export function ownerApprovalNeeded(files) {
  const reasons = [];
  for (const f of files) {
    const names = [f.filename, f.previous_filename].filter(Boolean);
    const text = [f.patch, f.content].filter(Boolean).join('\n');
    for (const name of names) {
      if (name.startsWith('.github/workflows/')) {
        if (WORKFLOW_NAME.test(name)) reasons.push(`${name}: a deploy/release/apply workflow`);
        for (const [re, why] of WORKFLOW_SIGNALS) if (re.test(text)) reasons.push(`${name}: ${why}`);
      } else if (name.startsWith('infra/') && !name.startsWith('infra/local/')) {
        if (INFRA_NAME.test(name)) reasons.push(`${name}: an OIDC, DNS, secrets-store or deploy file`);
        if (/\.md$/i.test(name)) continue; // documentation does not change the cloud
        const code = withoutComments(text);
        for (const [re, why] of INFRA_SIGNALS) if (re.test(code)) reasons.push(`${name}: ${why}`);
      }
    }
  }
  const unique = [...new Set(reasons)];
  return { required: unique.length > 0, reasons: unique };
}
