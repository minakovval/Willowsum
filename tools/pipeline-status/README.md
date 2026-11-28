# tools/pipeline-status — стан PR одним викликом

**Створено:** 2026-11-28

Рішення власника (2026-11-28, огляд токенів, пропозиція 3): замість кількох `gh api` на PR ведучий викликає один скрипт.
Тільки читає, лише REST через `gh api` (допоміжні функції `tools/pr-rules/lib/merge-ready.mjs`). Node 22, без залежностей.

```bash
node tools/pipeline-status/index.mjs [--ledger keep/ledger.tsv] [<PR> …]   # без номерів — усі відкриті PR
```

Один рядок на PR:
`#772 → <повний SHA голови> | CI green 12 (2 superseded) | Verdict: Ready | Security verdict: none | behind 3 | clean | sensitive,owner-decision | agents a:S aaa, r:O rrr`

- **CI** за назвою перевірки, вирішує найновіший запуск: `green N`, `running k of N: назви`, `red: назва=висновок`.
  Скасований дублікат вважається `superseded`, коли та сама назва десь успішна. Немає запусків — `none yet`.
- **Verdict / Security verdict** — останній вердикт, що називає саме поточну голову (рецензії лише від акаунта власника,
  як у `merge-ready`); `none`, коли такого немає. `Security verdict: n/a` для PR без мітки `sensitive`.
- **behind** — `behind_by` з `compare/main...<голова>`; **mergeable_state** — з `pulls/N` (`unknown` не перепитується).
- **agents** — рядки журналу ведучого цього PR (`роль:модель agentId`), лише з `--ledger`.
- Код виходу: 0 — усе прочитано; 1 — якийсь PR не прочитано (рядок `ERROR …`); 2 — помилка виклику.

Тести: `node --test 'tools/pipeline-status/test/*.test.mjs'`.
