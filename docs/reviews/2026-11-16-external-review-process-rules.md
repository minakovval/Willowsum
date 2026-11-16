# Передача ведучому: правила із зовнішнього рев'ю процесів (2026-11-16)

Це повідомлення власник передає ведучому як є. Його підготувала окрема сесія власника, яка зробила рев'ю процесів
і за дорученням власника («Сформулюй правила самостійно») сформулювала правила. Сесія не мала доступу до GitHub для
запису, тому зміни передано латкою нижче.

## Що зробити

1. Створи гілку `claude/adoring-cray-feh4dh-external-process-review` від актуального `main` (латку зроблено від
   `bf446d17102ed6b5afd36191b4c49a546ff8dcaa`).
2. Збережи вміст блоку «Латка» у файл і застосуй: `git am --3way <файл>`. Якщо не лягає — `git apply --3way`,
   а конфлікти розв'яжи за змістом: латка міняє лише `.claude/`, `docs/decisions/log/` і `docs/ops/`.
3. Перевір: `pnpm exec prettier --check .claude docs/ops docs/decisions/log`, `node --test tools/pr-rules tools/req-check`,
   `cat .claude/skills/pr-pipeline/SKILL.md .claude/skills/pr-pipeline/references/*.md | wc -l` (має бути ≤ 520).
4. Відкрий PR із назвою і тілом із блоків нижче (тіло проходить `tools/pr-rules local`; мітка — `owner-decision`).
5. Рецензія — `review-pr` на основній моделі: PR змінює правило про подробиці вад безпеки.
6. **Не зливай без рішення власника.** Зміст п'яти правил власник окремо не схвалював. Постав йому одне питання в
   чаті: «Правила 1–5 зовнішнього рев'ю: схвалити всі / лише такі-то / відхилити» — і запиши відповідь рядком
   `Рішення власника (YYYY-MM-DD): …` у тіло PR і в `docs/decisions/log/2026-11-16-external-process-review.md`.
   Відхилене правило прибери з PR.
7. Після злиття: нові правила діють одразу. Зараз відкрито 69 follow-ups (поріг 40), тож наступний вільний слот
   автора — рядок `R`. Як застосовувати кожне правило — `.claude/references/process-limits.md`.

## Назва PR

```
PRC-01: external process review — review cadence, rule text, follow-up limit, public repo, main protection
```

## Тіло PR

~~~~~markdown
## Requirement

PRC-01 — процес (правила ведучого), подання [docs/requirements/prc/PRC-01.poc.md](docs/requirements/prc/PRC-01.poc.md). Текст вимог не змінено: PR змінює лише правила в `.claude/`, журнал рішень і `docs/ops/`.

## Owner decision

Запис: [docs/decisions/log/2026-11-16-external-process-review.md](docs/decisions/log/2026-11-16-external-process-review.md).

Власник попросив окрему сесію (не ведучого) зробити рев'ю процесів і щодо рекомендацій сказав: «мені потрібен не коментар. Сформулюй правила самостійно»; на питання, чи комітити й відкривати PR, відповів: «Так, коміт і PR». Зміст кожного правила власник окремо не схвалював — він схвалює або відхиляє його в цьому PR. Тому рядка «Рішення власника … схвалено» тут немає; до відповіді власника PR не зливати.

Що вносить PR (формулювання сесії рев'ю):

1. Огляд процесу — коли злито ≥ 40 PR **і** минуло ≥ 24 год від попереднього (було: кожен третій номер ведучого); не більше 3 пропозицій за огляд. `restarts.md`, `new-session.md`.
2. Текст правила — лише норма, історія — в журналі рішень; `pr-pipeline` з `references/` — не більше 520 рядків (після цього PR рівно 520). `lead-communication.md`, «Rule text».
3. Ліміт follow-ups: понад 40 відкритих — наступний слот автора йде на рядок `R`; follow-up безпеки після двох зачисток отримує рядок плану. `SKILL.md`, крок 9.
4. Публічний репозиторій: подробиці невиправленої вади безпеки — у чернетку security advisory, в issue один рядок. `SKILL.md`, крок 7.
5. `merge-rules.md`: застаріле речення про безкоштовний план замінено; захист `main` вмикає власник за `docs/ops/browser-tasks/02-main-protection.md`.

Як застосовувати (команди, межі): `.claude/references/process-limits.md`.

Правило → нове місце (розмір): з абзаців кроків 7 і 9 `SKILL.md` прибрано примітки «(owner, дата, #178)» — вони є в `2026-11-13-*`, `2026-11-14-*`, `2026-11-15-*` журналу рішень; «Process review» у `restarts.md` переписано без цитати власника — вона в `2026-11-15-owner-process-review-every-3rd.md`.

## Impact (requirement changes)

Вимоги не змінено; `node tools/req-check/index.mjs --quiet` — 0 помилок. `node --test tools/pr-rules tools/req-check` — 625 тестів пройшли.

## Acceptance criteria covered

Не застосовно: PR не реалізує критеріїв приймання, лише правила процесу.

## How it was tested

- [ ] One automated test per acceptance criterion and edge case — не застосовно (без коду)
- [ ] Permission tests — не застосовно
- [ ] Entitlement check — не застосовно
- [ ] Empty / loading / error states — не застосовно

Перевірено вручну: команди підрахунку з `process-limits.md` (попередній огляд у #180, злиті PR відтоді, відкриті follow-ups — 69) виконано проти живого репозиторію; `prettier --check` чистий. Не перевірено: створення чернетки security advisory з хмарної сесії (у довідці позначено, що робити при відмові).

## Sensitive areas touched

- [ ] Auth / permissions / encryption / money / database schema / pipeline / infrastructure → needs security review

PR змінює правило про подробиці вад безпеки (крок 7) і формулювання про захист `main`: рецензія — на основній моделі (`token-economy.md`, п. 1).

## Open questions for the product owner

1. Схвалити чи відхилити кожне з п'яти правил вище.
2. Наявні відкриті issue з подробицями вад безпеки: перенести в advisories чи лишити до першого розгортання?
3. Звузити `sensitive:pipeline` для `pnpm-lock.yaml` (окремий PR коду з рецензією безпеки)?

🤖 Generated with [Claude Code](https://claude.com/claude-code)
~~~~~

## Латка

~~~~~diff
From 4ac32538813d56ceb4d2d524ee69e78e13849983 Mon Sep 17 00:00:00 2001
From: Valentyn Minakov <valentynminakov@Valentyns-MacBook-Pro-2.local>
Date: Mon, 16 Nov 2026 18:37:09 +0100
Subject: [PATCH] =?UTF-8?q?PRC-01:=20external=20process=20review=20?=
 =?UTF-8?q?=E2=80=94=20review=20cadence,=20rule=20text,=20follow-up=20limi?=
 =?UTF-8?q?t,=20public=20repo,=20main=20protection?=
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

Rules formulated by a separate review session at the owner's request
(docs/decisions/log/2026-11-16-external-process-review.md); how to apply
them: .claude/references/process-limits.md; owner task: browser task 02.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
---
 .claude/references/merge-rules.md             |  6 +-
 .claude/references/process-limits.md          | 69 +++++++++++++++++
 .claude/skills/pr-pipeline/SKILL.md           | 18 +++--
 .../references/lead-communication.md          |  8 ++
 .../pr-pipeline/references/new-session.md     |  5 +-
 .../skills/pr-pipeline/references/restarts.md | 20 ++---
 .../log/2026-11-16-external-process-review.md | 53 +++++++++++++
 docs/ops/browser-tasks/02-main-protection.md  | 77 +++++++++++++++++++
 docs/ops/integrations.md                      |  1 +
 9 files changed, 236 insertions(+), 21 deletions(-)
 create mode 100644 .claude/references/process-limits.md
 create mode 100644 docs/decisions/log/2026-11-16-external-process-review.md
 create mode 100644 docs/ops/browser-tasks/02-main-protection.md

diff --git a/.claude/references/merge-rules.md b/.claude/references/merge-rules.md
index ad94f44f..3dea4260 100644
--- a/.claude/references/merge-rules.md
+++ b/.claude/references/merge-rules.md
@@ -22,8 +22,10 @@ Read when you merge a PR, write an «Owner decision» section, or a PR acts on t
    that is only validated (infrastructure as code without apply, KMS and access rules described as code),
    CI check jobs and the local environment need no approval (owner, 2026-11-06). If the owner commented
    «stop» or asked a question on the PR, do not merge until they answer. Production releases still need the
-   owner's approval. Never push to `main` directly: the free GitHub plan cannot block it, so the process
-   is the protection.
+   owner's approval. Never push to `main` directly. The repository is public, so GitHub can enforce this (branch
+   protection: changes only through a PR, required checks); the owner switches it on
+   ([browser task 02](../../docs/ops/browser-tasks/02-main-protection.md)). Until then, and for whatever
+   the protection does not cover, the process is the protection.
    Once these conditions hold: do not ask the owner to confirm the merge; merge at once and tell the
    owner it is merged. **Merge on Ready, follow up separately** (owner, 2026-11-13): when both verdicts are Ready
    and only non-blocking findings remain, the lead merges; those items go to a follow-up PR or issue, not into
diff --git a/.claude/references/process-limits.md b/.claude/references/process-limits.md
new file mode 100644
index 00000000..27b43087
--- /dev/null
+++ b/.claude/references/process-limits.md
@@ -0,0 +1,69 @@
+# Process limits: how to check and apply them
+
+**Створено:** 2026-11-16 · **Оновлено:** 2026-11-16
+
+Read when a lead segment starts, before taking a new plan row, when a PR adds text to the lead's rules, or when a
+review finds a security defect that will not be fixed in the same PR. The rules themselves are in the files named
+in each heading; this file only says how to apply them.
+
+## Is a process review due? (`pr-pipeline/references/restarts.md`, «Process review»)
+
+```bash
+# 1. when the previous review was posted (its comment on #180 starts with «## Огляд процесу» or «## Перегляд процесу»)
+gh api 'repos/{owner}/{repo}/issues/180/comments?per_page=100' --paginate \
+  --jq '[.[] | select(.body | test("^## (Огляд|Перегляд) процесу"))] | last | .created_at'
+# 2. PRs merged since then (put the time from step 1 in place of <T>, e.g. 2026-11-16T15:35:41Z)
+gh api 'search/issues?q=repo:minakovval/Willowsum+is:pr+is:merged+merged:>'<T> --jq .total_count
+```
+
+Due only when step 2 gives 40 or more **and** `<T>` is at least 24 hours ago. Not due → no review, no comment;
+write «огляд процесу: не настав (N PR, H год)» in «Lead state». Due → the review comes before new tasks, and its
+comment starts with `## Огляд процесу ведучого N`, so the next check finds it. More than 3 proposals → the 3 with
+the largest expected saving go to the owner, the rest are listed in #178 under «Чекає наступного огляду».
+
+## Follow-up limit (`pr-pipeline/SKILL.md`, step 9)
+
+```bash
+gh api 'search/issues?q=repo:minakovval/Willowsum+is:issue+is:open+in:title+follow-ups' --jq .total_count
+```
+
+Run it before taking a new plan row. A follow-up issue is one whose title has «Follow-ups» or «follow-ups»; the lead
+names every such issue that way. More than 40 → the next free author slot gets row `R` (modules with no open PR,
+security items first) and new rows wait for the slots after it; the rows already in work continue. A security
+follow-up that two sweeps left open: add a row for it to the wave plan in the next plan-status PR and link the
+issue from the row.
+
+## Size of the lead's rules (`pr-pipeline/references/lead-communication.md`, «Rule text»)
+
+```bash
+cat .claude/skills/pr-pipeline/SKILL.md .claude/skills/pr-pipeline/references/*.md | wc -l   # at most 520
+```
+
+The author of a PR that changes these files runs it before pushing; the reviewer repeats it. Over the limit → in the
+same PR move rarely needed text to a reference outside the skill, or delete what a later rule replaced, and add the
+table «правило → нове місце» to the PR body. Inline history of the paragraphs the PR edits is removed only after
+checking that the decision log has it (`grep -rn "<date or #PR>" docs/decisions/log/`); if it does not, add the
+entry to the log first.
+
+## Security detail of an unfixed defect (`pr-pipeline/SKILL.md`, step 7)
+
+Applies to a finding that stays open in `main` after the merge (a «Follow-ups» item), when its probe, test or
+description would let a reader reproduce the bypass, leak or loss. A finding fixed in the same PR is not covered.
+
+1. The follow-up issue gets one line: module and the rule broken (e.g. «accounts: закриття рахунку не чекає
+   проводок у черзі»), no steps, inputs or code.
+2. The detail goes to a draft security advisory, visible only to the owner:
+   ```bash
+   # body.json: {"summary": "<same line>", "description": "<probe, steps, patch>", "severity": "medium",
+   #             "vulnerabilities": [{"package": {"ecosystem": "other", "name": "willowsum"}}]}
+   gh api -X POST 'repos/{owner}/{repo}/security-advisories' --input body.json --jq .html_url
+   ```
+   Link the advisory from the issue. Not yet tried in a cloud session: if the call is refused (403 or 404), do not
+   retry and do not post the detail anywhere else — keep it in the scratchpad `keep/` and tell the owner at once.
+3. When the fix is merged, add the fixing PR to the advisory's description and close the advisory.
+
+## Protection of `main` (`.claude/references/merge-rules.md`)
+
+The owner switches it on with [browser task 02](../../docs/ops/browser-tasks/02-main-protection.md). After that a
+direct push or a merge with a red required check is refused by GitHub; the lead's merge steps do not change. If a
+required check never starts on a PR, treat it as «CI cannot run» (`pr-pipeline/references/stacked-and-blocked.md`).
diff --git a/.claude/skills/pr-pipeline/SKILL.md b/.claude/skills/pr-pipeline/SKILL.md
index 87f0e084..9363220c 100644
--- a/.claude/skills/pr-pipeline/SKILL.md
+++ b/.claude/skills/pr-pipeline/SKILL.md
@@ -88,14 +88,18 @@ proposals: [lead communication](references/lead-communication.md).
 7. **After merge**: unsubscribe; the branch is deleted; reset the worktree to the new `main`
    (`git fetch origin main && git reset --hard origin/main`) or remove it; drop its test databases. The PR's
    «Follow-ups» go to one follow-up PR (lighter model) or an issue each, linked from the merged PR. Unmerged
-   **reviewer probes and tests** are posted at once on that follow-up issue inside `<details>`, split if over
-   65 000 characters (owner, 2026-11-15, #178). **Token and time accounting** (owner, 2026-11-13/14, mandatory):
-   in the same turn as the merge, before the agent logs can vanish, add the PR's row to the **body** of #180
-   ([token economy](references/token-economy.md), «Token accounting»).
+   **reviewer probes and tests** are posted at once on that issue inside `<details>`, split if over 65 000
+   characters. The repository is public: what shows how to exploit a security finding not yet fixed in `main` is
+   never posted in an issue or a PR — one line in the issue (module, rule broken), the detail in a draft security
+   advisory ([how](../../references/process-limits.md)); if that fails, tell the owner at once (§2, urgent).
+   **Token and time accounting** (mandatory): in the same turn as the merge, before the agent logs can vanish, add
+   the PR's row to the **body** of #180 ([token economy](references/token-economy.md), «Token accounting»).
 8. **Report to the owner**: «Мовчання в чаті» above; questions: §2.
-9. **Follow-up sweep** (owner, 2026-11-13/14, #178): after every 8–10 merged PRs, one PR (row `R`, lighter model)
-   closes the small open follow-ups (issues and the «Follow-ups» of merged PRs), security items first, only in
-   modules with no open PR; run it more often rather than less. Larger items get a plan row. Small process changes:
+9. **Follow-up sweep**: after every 8–10 merged PRs, one PR (row `R`, lighter model) closes the small open
+   follow-ups (issues and the «Follow-ups» of merged PRs), security items first, only in modules with no open PR.
+   Larger items get a plan row. **Limit:** while more than 40 follow-up issues are open, the next free author slot
+   goes to row `R` before any new plan row; a security follow-up left open by 2 sweeps gets its own plan row.
+   Count: [process limits](../../references/process-limits.md). Small process changes:
    [lead communication](references/lead-communication.md), «Batching process changes».
 
 Rare cases — [stacked PRs and CI that cannot run](references/stacked-and-blocked.md) (read when a PR depends on
diff --git a/.claude/skills/pr-pipeline/references/lead-communication.md b/.claude/skills/pr-pipeline/references/lead-communication.md
index 6db52b9d..a92ae920 100644
--- a/.claude/skills/pr-pipeline/references/lead-communication.md
+++ b/.claude/skills/pr-pipeline/references/lead-communication.md
@@ -20,3 +20,11 @@ A small process or rule change that does not block work goes into a queue (owner
 titled «Черга змін процесу», opened and kept by the lead («Lead state» only links to it). The queue ships together
 with the next process PR or the follow-up sweep (row `R`), not as a separate PR each. A separate PR is only for a
 change that blocks work or affects security, or that the owner asks for explicitly.
+
+## Rule text
+
+- A rule states the norm only: what to do and when. Who decided it, when, and which PR or incident caused it live
+  in the decision log (`docs/decisions/log/`). A PR that edits a rule paragraph removes that paragraph's inline
+  history («owner, date», issue and PR numbers, quotes) once the log has it. Each rule lives in one place.
+- Size: `pr-pipeline/SKILL.md` with its `references/` stays within **520 lines**; a PR that would exceed it shortens
+  other text in the same PR. How to check and apply: [process limits](../../../references/process-limits.md).
diff --git a/.claude/skills/pr-pipeline/references/new-session.md b/.claude/skills/pr-pipeline/references/new-session.md
index c7e6b2f1..ae04264a 100644
--- a/.claude/skills/pr-pipeline/references/new-session.md
+++ b/.claude/skills/pr-pipeline/references/new-session.md
@@ -30,6 +30,5 @@ owner in one code block, ready to copy without edits whenever the owner starts t
 token accounting (#180) and to work by `.claude/skills/pr-pipeline`; lists the start steps (rename, starting
 snapshot in #180, item-by-item handover confirmation with links, on #179 too after an automatic restart); names the
 first tasks and any open owner question; for an automatic restart states its count («1-й автоматичний перезапуск
-із 2»); for a number that is a multiple of 3 says the session starts with the process review ([restarts](restarts.md),
-«Process review»); and always includes the line «Технічних повідомлень у чаті не пиши (pr-pipeline, «Мовчання в
-чаті»).» The owner should not have to write or edit anything.
+із 2»); says the session starts with the process review when one is due ([restarts](restarts.md)); and always
+includes «Технічних повідомлень у чаті не пиши (pr-pipeline, «Мовчання в чаті»).» The owner edits nothing.
diff --git a/.claude/skills/pr-pipeline/references/restarts.md b/.claude/skills/pr-pipeline/references/restarts.md
index 4e410984..73ea5f57 100644
--- a/.claude/skills/pr-pipeline/references/restarts.md
+++ b/.claude/skills/pr-pipeline/references/restarts.md
@@ -42,7 +42,7 @@ agent; the lead then, in the same session:
 4. posts the handover table on #179 («Handover template»; the table stays at every handover, a compaction
    included: owner, 2026-11-16, #178, «ні, таблиця потрібна для відстеження історії»): «Передано» is «Lead state»
    as kept current, «Прийнято» is what lead N+1 re-read and did; the chat gets only the short retrospective;
-5. continues the pipeline. A lead number that is a multiple of 3 starts with the «Process review» below.
+5. continues the pipeline; when a «Process review» is due (below), it comes first.
 
 **Session names** (owner, 2026-11-13, #178): every lead is `Willowsum · ведучий N · <з чого починає>`, e.g.
 `Willowsum · ведучий 2 · хвиля 2 з рядка 3`; N is one more than the previous lead's, whether it ended in a
@@ -54,16 +54,18 @@ commit WIP after each step (SKILL.md step 2; owner, 2026-11-14, #178). **After a
 2026-11-15, #178): `send_later` at `rate_limit_info.resetsAt` + 5 minutes to resume; delete that scheduled task
 (`delete_trigger`) after the wake-up.
 
-**Process review** (owner, 2026-11-15, #178): «кожна третя сесія при запуску має ретроспективно передивитись всі
-покращення і зміни в процесах». A lead whose number is a multiple of 3 (from lead 9; after a compaction, the new
-number) does it after the start steps, before new tasks (≈ 100–150 k tokens, 1–2 PRs fewer), and reviews:
-1. every accepted process change since session 1 (#178, `docs/decisions/log/`, AGENTS.md, the skills) — rational,
-   needed, useful, optimal? — on the data of #180 (tokens, time, rounds);
+**Process review.** Due when **both** hold: at least 40 PRs were merged and at least 24 hours passed since the
+previous review's comment on #180 (commands: [process limits](../../../references/process-limits.md)). The lead
+that starts a segment checks it after the start steps; when due, the review comes before new tasks. It reviews:
+1. every accepted process change since the previous review (#178, `docs/decisions/log/`, AGENTS.md, the skills) —
+   rational, needed, useful, optimal? — on the data of #180 (tokens, time, rounds);
 2. the current instructions (AGENTS.md, `pr-pipeline` and `references/`, the other skills, `.claude/references/`):
    contradictions, duplication, outdated or unneeded text, what to simplify or shorten;
-3. the handovers of the last 5 leads: what «Lead state», start messages and confirmations lost or got wrong.
-Result: a comment on #180 with conclusions and proposals (each with risks, downsides, mitigations); the proposals go
-to «Черга змін процесу» (#178); no rule changes without an owner decision.
+3. the handovers since the previous review: what «Lead state» and the confirmations lost or got wrong.
+Result: a comment on #180 with conclusions and **at most 3 proposals**, ranked by expected saving (each with risks,
+downsides, mitigations); the rest waits in «Черга змін процесу» (#178) for the next review. No rule changes without
+an owner decision; between reviews only what [lead communication](lead-communication.md), «Batching process
+changes», allows as a separate PR.
 
 **Handover confirmation** (owner, 2026-11-13/14/15/16, #178,
 [comment 6899108018](https://github.com/minakovval/Willowsum/issues/178#issuecomment-6899108018)): every handover
diff --git a/docs/decisions/log/2026-11-16-external-process-review.md b/docs/decisions/log/2026-11-16-external-process-review.md
new file mode 100644
index 00000000..2b680fc9
--- /dev/null
+++ b/docs/decisions/log/2026-11-16-external-process-review.md
@@ -0,0 +1,53 @@
+# Рішення 2026-11-16: зовнішнє рев'ю процесів (окрема сесія власника)
+
+**Створено:** 2026-11-16
+
+Власник попросив окрему сесію (не ведучого) зробити рев'ю процесів проєкту. Сесія дала звіт у чаті з вісьмома
+рекомендаціями. Слова власника щодо них: «мені потрібен не коментар. Сформулюй правила самостійно». Нижче — правила,
+які сформулювала сесія рев'ю. Зміст кожного правила власник ще не схвалював: він схвалює або відхиляє їх у PR.
+
+Дані рев'ю (`main` `c444719`, GitHub API, #180): 242 злиті PR за 16 днів, з них 101 без продуктового коду (з 13.11 —
+69 зі 135); огляди процесу ведучих 9, 12 і 15 відбулися за одну добу; 67 відкритих follow-up issue після шести
+зачисток; репозиторій публічний, `main` на GitHub не захищено.
+
+## Правила, внесені цим PR
+
+- Формулювання сесії рев'ю (2026-11-16; власник не схвалював): огляд процесу роблять, коли від попереднього огляду
+  злито щонайменше 40 PR **і** минуло щонайменше 24 години, а не кожен третій номер ведучого; огляд дає не більше
+  3 пропозицій, решта чекає в #178. Чому: сегмент ведучого тепер 2–4 год, тож «кожен третій» дав три огляди за добу
+  і близько 5 змін правил з кожного. Ризики: проблема чекає довше. Пом'якшення: зміна, що блокує роботу чи
+  стосується безпеки, іде окремим PR одразу, як і раніше. Правило: `pr-pipeline/references/restarts.md`,
+  «Process review»; `new-session.md`, «Start message».
+- Формулювання сесії рев'ю (2026-11-16; власник не схвалював): текст правила містить лише норму; хто, коли і через
+  який PR її ухвалив — у журналі рішень. PR, що редагує абзац правила, прибирає з нього історію. `pr-pipeline`
+  разом із `references/` — не більше 520 рядків (зараз 520). Чому: 158 приміток «(owner, дата)» у правилах; набір
+  ведучого ріс попри рішення огляду 12 його скоротити. Ризики: загубити нюанс при скороченні. Пом'якшення: таблиця
+  «правило → нове місце» в тілі PR. Правило: `pr-pipeline/references/lead-communication.md`, «Rule text».
+- Формулювання сесії рев'ю (2026-11-16; власник не схвалював): поки відкрито понад 40 follow-up issue, наступний
+  вільний слот автора йде на рядок `R`, а не на новий рядок плану; follow-up безпеки, який не закрили дві зачистки,
+  отримує власний рядок плану. Ризики: повільніше нові рядки. Пом'якшення: рядок `R` на легшій моделі й лише в
+  модулях без відкритих PR. Правило: `pr-pipeline/SKILL.md`, крок 9.
+- Формулювання сесії рев'ю (2026-11-16; власник не схвалював): репозиторій публічний, тому те, що показує, як
+  використати ще не виправлену в `main` ваду безпеки, не публікують в issue чи PR: в issue — один рядок (модуль і
+  порушене правило), подробиці — у чернетці repository security advisory. Ризики: агент може не мати права
+  створити advisory (не перевірено). Пом'якшення: тоді ведучий одразу пише власнику як про термінове. Правило:
+  `pr-pipeline/SKILL.md`, крок 7.
+- Формулювання сесії рев'ю (2026-11-16; власник не схвалював): у `merge-rules.md` речення «the free GitHub plan
+  cannot block it» замінено: для публічного репозиторію захист гілки доступний, його вмикає власник; до того і поза
+  його межами захист — процес. Правило: `.claude/references/merge-rules.md`.
+
+Як застосовувати кожне правило (команди підрахунку, кроки, що робити на межі) — `.claude/references/process-limits.md`;
+правила посилаються на цю довідку. Власник запитав про це окремо: «чи додані інструкції як ще застосовувати?».
+
+## Що лишається власнику і конвеєру
+
+- Дія власника: увімкнути захист `main` на GitHub за `docs/ops/browser-tasks/02-main-protection.md` (зміни лише через
+  PR, обов'язкові перевірки `changes`, `requirements`, `secrets`, `traceability` — ті, що запускаються на кожному PR).
+- Не внесено, потрібен PR коду з рецензією безпеки: звузити `sensitive:pipeline` для `pnpm-lock.yaml`
+  (`tools/pr-rules/lib/paths.mjs`; зараз мітку отримує і UI-PR, що лише додає залежність) — файл стоїть у переліку
+  свідомо, як ланцюг постачання, тож це рішення власника.
+- Не внесено, потрібен інструмент: «Lead state» зі скрипта за даними API замість ручного тіла #179.
+- Питання власнику без правила: рівень строгості PoC на синтетичних даних (мутаційне тестування і Fable на кожен
+  грошовий PR зараз чи з MVP).
+- Уже наявні відкриті issue з подробицями вад безпеки нове правило не чіпає: перенести їх чи лишити — рішення
+  власника до першого розгортання.
diff --git a/docs/ops/browser-tasks/02-main-protection.md b/docs/ops/browser-tasks/02-main-protection.md
new file mode 100644
index 00000000..8b5fcbb0
--- /dev/null
+++ b/docs/ops/browser-tasks/02-main-protection.md
@@ -0,0 +1,77 @@
+# Завдання для локальної сесії Claude з браузером: захист гілки `main` репозиторію Willowsum на GitHub
+
+**Створено:** 2026-11-16 · **Оновлено:** 2026-11-16
+
+## Для кого цей текст
+
+Ти — локальна сесія Claude, яка керує браузером власника продукту Willowsum. Цей документ дав тобі власник.
+Виконуй кроки по черзі сам. Зупиняйся і проси власника лише там, де написано «ЗУПИНКА». Говори з власником
+українською, коротко.
+
+## Що вже є
+
+- Репозиторій `minakovval/Willowsum` на GitHub, публічний, на безкоштовному плані. Для публічних репозиторіїв
+  правила гілок (rulesets) безкоштовні.
+- Гілка `main` зараз не захищена: пуш напряму забороняють лише правила процесу
+  ([merge-rules.md](../../../.claude/references/merge-rules.md)).
+- PR зливає ведучий агент способом squash, без схвалень на GitHub: вердикти — це рецензії-коментарі.
+- Перелік інтеграцій: [`docs/ops/integrations.md`](../integrations.md), рядок «GitHub». Вимоги: CICD-01, ADR-0008.
+
+## Мета
+
+Одне активне правило для `main`: зміни лише через PR, без force push і видалення гілки, з чотирма обов'язковими
+перевірками CI. Більше нічого в налаштуваннях не змінено.
+
+## Жорсткі правила
+
+- **Ніколи** не вставляй ключі, токени чи паролі в чат, у звіт, у файли, у GitHub чи кудись ще.
+- **Не плати** і не змінюй тариф. Якщо GitHub просить платний план — ЗУПИНКА.
+- **Не приймай юридичні угоди** замість власника — ЗУПИНКА.
+- **Не змінюй і не видаляй** нічого іншого: секрети Actions, середовища, вебхуки, видимість репозиторію, інші
+  правила, якщо вони є.
+- Якщо інтерфейс не такий, як описано, — розберись сам; якщо не виходить за 2 спроби — ЗУПИНКА.
+
+## Крок 1. Створити правило
+
+1. Відкрий https://github.com/minakovval/Willowsum/settings/rules . Якщо власник не увійшов або GitHub просить
+   підтвердити пароль — ЗУПИНКА: хай увійде сам.
+2. Якщо правило з назвою `main` уже є — відкрий його і звір із пунктами нижче; інакше **New ruleset → New branch
+   ruleset**.
+3. **Ruleset Name:** `main`. **Enforcement status:** `Active`.
+4. **Bypass list:** лиши порожнім (правило діє і для власника).
+5. **Target branches → Add target → Include default branch.**
+6. У **Branch rules** увімкни лише це:
+   - **Restrict deletions**;
+   - **Block force pushes**;
+   - **Require a pull request before merging** — «Required approvals» = `0`; інші прапорці цього блоку вимкнені;
+     «Allowed merge methods» — лише `Squash`, якщо таке поле є;
+   - **Require status checks to pass** — додай рівно чотири перевірки: `changes`, `requirements`, `secrets`,
+     `traceability` (шукай за назвою; джерело — GitHub Actions). Прапорець «Require branches to be up to date
+     before merging» — **вимкнений**: актуальність гілки перевіряє ведучий за своїми правилами.
+7. Не вмикай: «Require signed commits», «Require linear history», «Require deployments», «Require code scanning
+   results», «Require merge queue».
+8. **Create** (або **Save changes**).
+
+Перевірки `web`, `api`, `e2e`, `infra`, `local-env` обов'язковими не роби: фільтр шляхів їх пропускає для частини
+PR, і правило заблокувало б такі PR.
+
+## Крок 2. Перевірити
+
+1. Відкрий https://github.com/minakovval/Willowsum/branches — біля `main` має бути позначка захисту.
+2. Відкрий будь-який відкритий PR зі сторінки https://github.com/minakovval/Willowsum/pulls : у блоці злиття чотири
+   перевірки мають бути позначені «Required». Нічого не зливай і не закривай.
+3. Якщо котроїсь із чотирьох перевірок GitHub не знаходить за назвою — не вигадуй іншу; збережи правило без неї і
+   напиши про це у звіті.
+
+## Звіт власнику
+
+Передай власнику цей блок, заповнивши пропуски; він вставить його в сесію ведучого:
+
+```
+browser-task-02 виконано: правило «main» — Active, цілі: default branch.
+Увімкнено: Restrict deletions, Block force pushes, PR перед злиттям (0 схвалень),
+обов'язкові перевірки: <перелік доданих>.
+Не знайдено перевірок: <перелік або «немає»>.
+Перевірка на PR #<номер>: Required показано — <так/ні>.
+Іншого не змінював.
+```
diff --git a/docs/ops/integrations.md b/docs/ops/integrations.md
index cd92d7e3..7c564d04 100644
--- a/docs/ops/integrations.md
+++ b/docs/ops/integrations.md
@@ -56,4 +56,5 @@
 | Завдання | Що робить | Де |
 | --- | --- | --- |
 | browser-task-01 | Resend (ключ для вже підтвердженого домену, EU) і віджет Cloudflare Turnstile «Willowsum» для `willowsum.mina.yachts` | [`browser-tasks/01-mail-captcha.md`](browser-tasks/01-mail-captcha.md) |
+| browser-task-02 | Захист гілки `main` на GitHub: зміни лише через PR, без force push, обов'язкові перевірки `changes`, `requirements`, `secrets`, `traceability` | [`browser-tasks/02-main-protection.md`](browser-tasks/02-main-protection.md) |
 | OCI account | Обліковий запис OCI, MFA, бюджет, другий регіон (інструкція для власника, створена до рішення 2026-11-12) | [`infra/start/owner-setup.md`](../../infra/start/owner-setup.md) |
-- 
2.50.1 (Apple Git-155)

~~~~~
