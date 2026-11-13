# A test that fails only sometimes

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Shared by several skills (owner, 2026-11-13: rare parts moved out of the skills). Read when a test fails intermittently, locally or in CI.

A test that fails only sometimes needs a root cause, never «load», «flake» or «timeout under load» as the
explanation (owner, 2026-11-13): reproduce it, compare with `main`, find the cause (#146: tests sharing
`apps/api/test/.tmp` deleted each other's folders; whole-tree analysis tests ran without a timeout of their
own). If you cannot find it in this PR, file a separately tracked issue with the evidence (run link, log lines,
how to reproduce). Never skip, quarantine or raise a timeout without a stated basis.
