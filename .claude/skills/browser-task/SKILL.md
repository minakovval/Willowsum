---
name: browser-task
description: Write an instruction for the Willowsum owner's local Claude session with a browser (docs/ops/browser-tasks/NN-<topic>.md) — accounts, service settings, DNS, keys — and update docs/ops/integrations.md. Use when the owner must act in a third-party web console.
---

# Write a browser task for the owner's local Claude session

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-12

Agents never hold the owner's accounts or keys (`.claude/references/external-services.md` (AGENTS.md links it)). When the
owner must act in a browser, the lead writes a ready instruction that the owner hands to their local Claude
session with a browser. That session does the work itself and stops only where the instruction says
«ЗУПИНКА». Example: `docs/ops/browser-tasks/01-mail-captcha.md`.

## File

`docs/ops/browser-tasks/NN-<topic>.md` (next free number), in Ukrainian, with the «Створено / Оновлено» line.

## Structure

1. **Для кого цей текст** — «Ти — локальна сесія Claude, яка керує браузером власника…»; do the steps
   yourself, stop only at «ЗУПИНКА», talk to the owner in Ukrainian, briefly.
2. **Що вже є** — facts already known (accounts, domains, existing settings that must not be touched), and a
   link to the integrations list (`[docs/ops/integrations.md](../integrations.md)` from the task file) and the
   requirements involved.
3. **Мета** — what must exist at the end, in one or two lines.
4. **Жорсткі правила**:
   - no keys, tokens or passwords in chat, the report, files, GitHub or anywhere else — secrets live only in
     the service console and the owner's password manager;
   - no payment and no plan change; free tiers only;
   - legal terms (ToS, DPA) are accepted by the owner, never by the session;
   - no domain purchase;
   - do not change or delete anything else (other projects' widgets, keys, DNS records).
5. **Кроки** — numbered, with exact URLs, menu names, field values and names for keys and records. Mark a
   **ЗУПИНКА** only for: sign-in, payment, legal acceptance, saving a secret to the password manager, and
   an interface that differs from the text and still does not work after 2 tries.
6. **Звіт власнику** — a ready message block the owner pastes into the cloud session: what was created
   (names, regions, statuses), what is left; **no secrets**. Keys reach the cloud session later only through
   the secure credential form, when it needs them.

## Also update

- `docs/ops/integrations.md`: the service's row (account, how we interact, where credentials live, region,
  plan, status) and the «Інструкції для браузера» table, in the same PR.
- The decision log (`docs/decisions/`) when the task records an owner decision (domain, region, sender).

Tell the owner in chat, in Ukrainian, which file to hand to the local session and what it will stop for.
