# A test that fails only sometimes

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-19

Shared by several skills. Read when a test fails intermittently, locally or in CI.

A test that fails only sometimes needs a root cause, never «load», «flake» or «timeout under load» as the
explanation: reproduce it, compare with `main`, find the cause (#146: tests sharing
`apps/api/test/.tmp` deleted each other's folders; whole-tree analysis tests ran without a timeout of their
own). If you cannot find it in this PR, list it under «Follow-ups» with the evidence (run link, log lines,
how to reproduce); the lead opens the issue. Never skip, quarantine or raise a timeout without a stated basis.

**Register.** Every CI job that passes after one rerun gets a row in issue #610, added by the lead. A second failure of
the same test: the lead starts a fix agent at once. A test is never weakened to make it pass (`security-review` §0 bans).
