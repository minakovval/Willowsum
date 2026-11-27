# Security scan (SAST and SCA)

**Створено:** 2026-11-27 · **Оновлено:** 2026-11-27

The CI job `security` (`.github/workflows/pr-checks.yml`, every PR) blocks a PR on a High or Critical finding:
CICD-02@PoC criteria «Статичний аналіз безпеки коду» and «Вразливості залежностей», NFR-01@PoC criterion
«Вразливості» (owner decision 7, `docs/decisions/log/2026-11-26-owner-ambiguity-answers.md`). DAST stays in MVP.

- **SAST:** Semgrep CE 1.185.0 with the committed ruleset [`semgrep/rules.yml`](semgrep/rules.yml) only — no rule
  registry, no metrics, no login; inline `nosemgrep` comments are ignored (`--disable-nosem`). `severity: ERROR` is
  High or Critical (`metadata.security-severity`) and blocks; `WARNING` is Medium and is only reported. Scanned:
  `apps`, `packages`, `tools`, `infra`; tests, e2e and fixtures are excluded (`.semgrepignore` at the root).
- **SCA:** `pnpm audit --prod` (the pnpm version of `package.json`): High and Critical advisories in production
  dependencies block; Moderate and Low are only reported.
- **Allowlist:** [`allowlist.json`](allowlist.json). A SAST entry names the rule, the file and at least 16
  characters of the flagged line (`match`), and accepts exactly `count` findings (default 1; one more blocks); an SCA entry names the GHSA id, the package and the exact versions (an updated dependency
  is checked again, NFR-01 EC1). Every entry has `kind` (`false-positive` or `accepted-risk`), `reason`, `owner`,
  `decision` and `review_by` (at most 366 days ahead). An accepted risk — every SCA entry — needs
  `Рішення власника (YYYY-MM-DD): …`; a false positive may carry the lead's decision. An entry past its review date
  (NFR-01 AC2) or matching nothing any more fails the job. The allowlist is changed only in a reviewed PR.

## Run locally

```sh
python3 -m venv ~/.cache/ws-semgrep
~/.cache/ws-semgrep/bin/pip install --require-hashes --no-deps -r tools/security-scan/semgrep/requirements.txt
export WS_SEMGREP=~/.cache/ws-semgrep/bin/semgrep

node tools/security-scan/index.mjs sast              # whole repository, as CI (about 40 s)
node tools/security-scan/index.mjs sast apps/api/src # some paths only (stale entries are not reported)
node tools/security-scan/index.mjs sca               # pnpm audit of production dependencies
node --test tools/security-scan                      # the rules find known-bad code; a High finding fails
```

## Change the ruleset or the version

- A new rule gets a known-bad line in `test/fixtures/bad.ts.txt` (or `bad.tsx.txt`) marked `// expect: <rule id>`
  and, where the codebase has a safe form, that form in `good.ts.txt`; the tests fail for a rule without one.
- A new Semgrep version: change `semgrep/requirements.in`, regenerate `semgrep/requirements.txt` with the `uv`
  command at its top, run the commands above.
