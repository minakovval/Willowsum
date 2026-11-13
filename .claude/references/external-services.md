# External services and owner actions

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of AGENTS.md without change (owner, 2026-11-13: shorter AGENTS.md and skills). Read when a PR adds or changes an external service, or the owner must act in a web console.

Owner decision of 2026-11-12:

- `docs/ops/integrations.md` is the single list of all third-party services: purpose, account, how we
  interact, where credentials live, data sent, region, plan, requirements, status. The PR that adds or
  changes an integration updates its row.
- Agents never hold the owner's accounts or keys. When the owner must act in a browser (accounts,
  settings, DNS, legal acceptance), the lead writes a ready instruction in `docs/ops/browser-tasks/` for the
  owner's local Claude session with a browser. That session does the work itself and stops only for
  sign-in, payment, legal acceptance and saving secrets to the owner's password manager. Secrets never go
  to chat, issues, PRs or the repository.
