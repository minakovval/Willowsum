# Рішення 2026-11-27: історію рішень прибрано з правил для агентів — вона лишається в журналі

**Створено:** 2026-11-27 · **Оновлено:** 2026-11-27

Журнал лише дописується. Запис до PR «оновлені правила» (пропозиція незалежного рецензента процесу). Рішення власника
про ці правила — у [2026-11-27-owner-rules-rewrite.md](2026-11-27-owner-rules-rewrite.md).

## Що зроблено

З файлів нижче прибрано примітки «(owner, дата, #…)» і «(lead, дата)»: правило лишилося, змінилося лише місце історії.
Кожну примітку наведено дослівно, з кінцем речення, до якого вона стояла. Дати 2026-11-12 … 2026-11-27 мають
записи в `docs/decisions/log/` або в архіві `docs/decisions/state-2026-11-05.md`.

### `.claude/skills/fix-review-findings/SKILL.md`

- «…do not pick one yourself. On a lighter model applying ready patches» — (owner, 2026-11-14, #178)
- «…«timeout under load»» — (owner, 2026-11-13)
- «…`docs/decisions/log/YYYY-MM-DD-<short-slug>.md`» — (a numeric suffix if the name is taken; owner, 2026-11-13)
- «…Before tests» — (owner, 2026-11-14, #178)
- «…Scratchpad files» — (owner, 2026-11-13)
- «…**Local PR checks before every push and body change**» — (owner, 2026-11-13)
- «…3. **Report to the lead**» — (owner, 2026-11-16, process review 15, proposal 3)

### `.claude/skills/implement-requirement/SKILL.md`

- «…- Before tests» — (owner, 2026-11-14, #178)
- «…- Text fingerprints» — (owner, 2026-11-16, items 6–8)
- «…Committing and pushing to your own PR branch is part of the task» — (owner, 2026-11-13, #178: «дозволяю»)
- «…**Self-check before review**» — (owner, 2026-11-13)
- «…**Report to the lead**» — (owner, 2026-11-16, process review 15, proposal 3)
- «…llow-ups»: the lead opens the issues) goes in the PR body. Report ONCE: do not re-send it» — (owner, 2026-11-16, #178)

### `.claude/skills/pr-pipeline/SKILL.md`

- «…Лише українською, у кожному повідомленні, навіть в одному рядку статусу» — (власник, 2026-11-13; 2026-11-19)
- «…most frequent reviewer findings for that module, taken from the reviews of its recent PRs» — (a test per criterion, a permission check, a `.catch` without a test; owner, 2026-11-27; no new self-check step)
- «…the rest of the module only when needed; `security-review` of a `sensitive` PR stays full» — (owner, 2026-11-27)

### `.claude/skills/pr-pipeline/references/merge-checklist.md`

- «…R after it, unless it fixes a red `main` or a security issue, or the owner says otherwise» — (owner, 2026-11-27)
- «…once as a red `main`» — (owner, 2026-11-20)

### `.claude/skills/pr-pipeline/references/restarts.md`

- «…and a notification with nothing for the owner, the only reply is «Нічого нового для вас.»» — (owner, 2026-11-27)
- «…and #480» — (owner, 2026-11-19)

### `.claude/skills/review-pr/SKILL.md`

- «…**Scope on a `sensitive` PR**» — (owner, 2026-11-13)
- «…**Re-review**» — (owner, 2026-11-12)
- «…» — (owner, 2026-11-16, «2 а»; `pr-pipeline` token economy, item 2)
- «…Scratchpad files» — (owner, 2026-11-13)
- «…» — (owner, 2026-11-12)
- «…the PR claims (its FR/AC) or of a shared rule (AGENTS.md, П-rules)» — (owner, 2026-11-12)
- «…**UI screenshot**» — (owner, 2026-11-19; rule: [screen-from-canvas](../screen-from-canvas/SKILL.md) §6)
- «…locally if needed. Drop findings you cannot support. Before tests» — (owner, 2026-11-14, #178)
- «…hand-made database» — (owner, 2026-11-14, #178, «так, 1–4 так, пункт 3 як пробні 2 запуски»)
- «…**Rely on CI for the full suites**» — (owner, 2026-11-13)
- «…Post one PR review of this shape» — (a confirmation of a sensitive PR by one agent posts two PR reviews with commit_id, one per verdict line; pr-pipeline step 5, owner, 2026-11-14, #178)
- «…**Report to the lead**» — (owner, 2026-11-16, process review 15, proposal 3)
- «…n-blocking items, the coverage table) stays in the review. Report ONCE: do not re-send it» — (owner, 2026-11-16, #178)
- «…**At most two rounds**» — (owner, 2026-11-12)
- «…The lead merges» — (AGENTS.md step 7, owner, 2026-11-13)
- «…commit» — (owner, 2026-11-12)
- «…and review stand in for it» — (owner, 2026-11-13; [merge rules](../../references/merge-rules.md))
- «…code PR without `sensitive` with a byte-identical diff and green CI» — (owner, 2026-11-16; merge rules)
- «…`sensitive` PR whose sync is mechanical and brought no foundation file» — (owner, 2026-11-16, «1 б»; merge rules)
- «…a separate security review — say so if it has not had one; other PRs need none» — (owner, 2026-11-12)
- «…content» — (owner, 2026-11-19)

### `.claude/skills/screen-from-canvas/SKILL.md`

- «…an label (`grep -l 'role="switch"' design/canvas/Poc*.dc.html`); the views stay unchanged» — (lead, 2026-11-13)
- «…efreshes both snapshots from the live artifacts in a separate PR before the component PRs» — (lead, 2026-11-13)
- «…component, not a route per component» — (lead, 2026-11-13)
- «…**Screenshot with long texts in every PR that changes a screen or a shared UI component» — (owner, 2026-11-19, chat: «так, впроваджуй»; [log](../../../docs/decisions/log/2026-11-19-owner-screenshot-rule.md))
- «…Scratchpad files» — (owner, 2026-11-13)
- «…**Report to the lead**» — (owner, 2026-11-16, process review 15, proposal 3)
- «…lse (the checklist above, follow-ups) goes in the PR body. Report ONCE: do not re-send it» — (owner, 2026-11-16, #178)

### `.claude/skills/security-review/SKILL.md`

- «…- **Security properties only**» — (owner, 2026-11-13)
- «…- **Light confirmation**» — (owner, 2026-11-13)
- «…- Before tests» — (owner, 2026-11-14, #178)
- «…hand-made database» — (owner, 2026-11-14, #178, «так, 1–4 так, пункт 3 як пробні 2 запуски»)
- «…- **Rely on CI for the full suites**» — (owner, 2026-11-13)
- «…- Scratchpad files» — (owner, 2026-11-13)
- «…Post one PR review of this shape» — (a confirmation of a sensitive PR by one agent posts two PR reviews with commit_id, one per verdict line; pr-pipeline step 5, owner, 2026-11-14, #178)
- «…- **Confirmation round**» — (owner, 2026-11-13; after a fix commit, your ready fix or a `sync-branch` merge)
- «…**Report to the lead**» — (owner, 2026-11-16, process review 15, proposal 3)
- «…(output file paths, the mutant table) stays in the review. Report ONCE: do not re-send it» — (owner, 2026-11-16, #178)

### `AGENTS.md`

- «…the same rules; a branch is deleted after its PR is merged. How many agents run at once» — (up to 10, plus up to 8 additional Sonnet agents, owner, 2026-11-19)
