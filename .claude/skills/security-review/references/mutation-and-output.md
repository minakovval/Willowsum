# Mutation testing and output files («4.» and «5.», full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `security-review` SKILL.md without change (owner, 2026-11-13). Read when the PR touches a critical module (isolation, money, authentication, encryption) or you hand tests and patches to the author.

## 4. Mutation testing (critical modules only)

Only for data isolation, money, authentication and encryption (owner, 2026-11-12); elsewhere skip it.

1. Weaken one guard at a time (drop a `WHERE household_id`, return early from a permission check, compare
   with `==` instead of a constant-time check, round an amount through `number`).
2. Run only the relevant suite. A mutant that no test kills is a **survivor**.
3. Restore the code (`git checkout -- <file>`) before the next mutant; never leave a mutant in place.
4. For each survivor write a test that kills it.

Defects found: write the test as `it.fails('…', …)` (it documents the defect and passes while the defect
exists) plus a fix patch you verified: with the patch applied the test passes as a plain `it`.

## 5. Output files

Put every test and patch in the session scratchpad (not in the PR branch), in one file per round with a
header per repository file:

```
// ===== FILE: apps/api/test/sec<PR>-<topic>.it.test.ts =====
…
// ===== FILE: apps/api/src/modules/identity/application/sign-in.ts (patch) =====
…
```

No secret-shaped literals (API keys, tokens, private keys, passwords that look real): build test values at
runtime (`randomBytes`, `['not','a','real','value'].join('-')`), so the CI job `secrets` (gitleaks) stays green.
The author applies them with the `fix-review-findings` skill.
