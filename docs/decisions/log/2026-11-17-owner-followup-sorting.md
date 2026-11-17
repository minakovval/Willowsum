# Рішення 2026-11-17: сортування відкритих follow-up — рядки 198–209, перелік MVP, закриття issue

**Створено:** 2026-11-17

Контекст: ведучий розібрав 143 відкриті issue follow-up (847 пунктів) на чотири групи: A — гроші і втрата даних
(114 пунктів, нові рядки плану), B — закрити як непотрібне (210), C — у MVP (398), D — уже покрито рядком плану
(125), і надіслав розбір власнику. Власник відповів двічі в чаті 2026-11-17; відповіді передав ведучий («власник,
чат ведучому, за повідомленням ведучого»), тут вони дослівно, англійською, як їх записав ведучий. Журнал лише
дописується; попередні записи не змінено.

## Відповідь 1 (≈ 07:45 UTC): групи A, C і D

Рішення власника (2026-11-17): схвалено групу A — рядки плану 198–209. Слова власника: «Group A approved. Add plan
rows 198–209 as proposed.» Виконано: `docs/plans/poc-wave-2.md`, розділ «Рядки з триажу follow-up (2026-11-17)»;
кожен рядок служить умові завершення PoC 5 (немає відкритих follow-up про гроші або втрату даних).

Рішення власника (2026-11-17): схвалено групу D — кожен пункт закривається з посиланням на свій рядок плану. Слова
власника: «Group D approved: close each item with a pointer to its plan row.»

Рішення власника (2026-11-17): схвалено групу C (у MVP) з винятками. Слова власника: «Group C (to MVP) approved, with
these exceptions:»

1. «Stay in PoC:
   - #401: check the local run on a real Mac, SIGTERM, waitReady.
   - #441 and #424: S-050 rows link to S-053.
   - #454: the error state of the accounts list, and server field errors in S-055a.
   - #400: the sign-out button. Check plan rows 109–110 first; if they already cover it, point there, otherwise add
     it to row 110.»

   Виконано: #401 — рядок 172; #441 і #424 — рядок 113; #454 — рядок 114; #400 — рядок 110. Перевірка рядків 109–110:
   обидва злито (#365 і #364), кнопки виходу в жодному немає — у `apps/web` і в каталозі текстів немає елемента
   виходу, серверний маршрут `signOut` є, — тож кнопку додано в рядок 110 як доробку.
2. «Attach to existing rows:
   - #337 and #228 (idempotency key) go to A10, which is merged into row 202.
   - #315 item 12 goes to row 26.
   - #251 item 6, #277 item 5, #252 item 14 and #257 item 7 go to row 190 a) or the A1 project.
   - #188 N5 (an event with no subscriber is lost) goes to the A1 project and the ADR-0015 review.»

   Виконано: рядки 202, 26, 190 а) і 182 (поправки ADR-0015, проєкт A1).
3. «Do now, in the sorting PR: #443 (stage 7 «Звіти» wording; the plan count 153 vs 156). #402 and #375 are closed
   later by the rules clean-up PR; do not touch them here.»

   Виконано: етап 7 дає «Підсумок періоду в «Бюджеті» і «Боргах»»; рядки плану перелічено заново — 160 PR у частинах
   A–G (таблиця давала 156, вступ — 153), усі названі підсумки узгоджено. Пункти C issue #402 і #375 у перелік MVP не
   внесено.

Решту групи C записано в `docs/plans/mvp.md`, розділ «Доробки з триажу follow-up (2026-11-17)».

Про групу B у першій відповіді: «Group B (close as not needed): no answer yet. Do not close any B item.» Про поріг
зачистки R: «R-sweep threshold: not approved. A reviewer-rule proposal comes instead.» Поріг не змінено.

## Відповідь 2: група B і доповнення до C

Рішення власника (2026-11-17): схвалено групу B — закрити як непотрібне — крім 14 пунктів. Слова власника: «Owner
answer 2, 2026-11-17 (chat), on group B: approved, except 14 items.»

1. «Do not close #202 (the security reviewer's 4 tests), #209 (tests S1–S4), #244 item 1, or #300 (the sec242-details
   probes). Move them to C, each with the task «write the tests again from the review's description».» Виконано:
   чотири пункти — у переліку MVP з цим завданням.
2. «Do not close #165, where the XLS mitigation was attributed to the owner. Add a separate correction entry to the
   decision log that says whose decision it really was. Check the history first.» Виконано: запис «Виправлення»
   нижче.
3. «#459 items 1, 2 and 5, #246 (its four board items) and #111: these screens are not built yet. Write each
   board-vs-requirement mismatch into the plan row of its screen, then close the issue. Do not redraw the boards.»
   Виконано: рядки 139, 136, 138 і 143 (#459); 123, 125, 126, 128 і 121 (#246); 123 і 139 (#111). Дошки не змінено.
4. «Attach #298 «Залишок читається поза блокуванням» to row 198, and check it together with the shared account
   lock.» Виконано: рядок 198.

«Close the rest of B. The owner starts PoC from a clean database, so the reason «таких даних у PoC немає» is valid.»
Решту пунктів B ведучий закриває після злиття з причиною з триажу.

Рішення власника (2026-11-17): схвалено — #161 п. 1 і 2 зробити зараз, у PR сортування. Слова власника: «Addition to
C, item 3: do #161 items 1 and 2 now, in the sorting PR.» Виконано в тому самому PR окремим комітом: перевірку
свіжості таблиць випусків браузерів (NFR-07@PoC FR 1) перенесено з CI кожного PR у щоденну перевірку `main`
(`tools/pr-rules`, команда `daily`; таблиці — `apps/web/src/browser/releases.json`), застарілу таблицю вона показує
в issue `main-check`; `supportCutoff` для останнього дня довгого місяця дає останній день цільового місяця
(2026-05-31 → 2026-02-28, 12-31 → 09-30). Файли робочих процесів не змінено.

## Виправлення: чиє рішення — пом'якшення для XLS (2026-11-13)

Запис від 2026-11-13 у [`2026-11-13-poc-wave-2-scope-moves.md`](2026-11-13-poc-wave-2-scope-moves.md) («власник (чат
ведучому, за повідомленням ведучого): «додати»») читається так, ніби вимоги до XLS були частиною відповіді власника.
За історією PR #163 це не так:

- Рішення власника там одне: слово «додати» на питання, чи приймати XLS у PoC, — XLS лишається в IMP-01@PoC і входить
  до переліку дозволених типів.
- Пом'якшення — книга XLS із потоком VBA чи макросів відхиляється; XLS у форматі Excel 5/95 і зашифровані файли
  відхиляються; розбір кожного завантаження йде в окремому процесі з обмеженням пам'яті — додав автор PR #163 разом із
  відповіддю, бо антивірусу в PoC немає (тіло PR #163, п. 5: «Because PoC has no antivirus, three rules are added»);
  повторна рецензія безпеки (review 5891980911, розділ 2) оцінила їх як достатні. Рецензія на `0a07905` (review 5892024839, п. 1 неблокувальних) це помітила: «If the
  owner only said «додати», mark those mitigations as the lead's or the security review's».

Отже: Рішення ведучого (2026-11-13; власник не схвалював; PR #163, перевірено рецензією безпеки): три пом'якшення для XLS.
Тексти вимог (ARC-06@PoC п. 4, NFR-15@PoC п. 18 і AC6, IMP-01@PoC) не змінюються; змінюється лише те, кому приписано
рішення. Старий запис лишається як є (журнал лише дописується), issue #165.

## Рішення ведучого

Рішення ведучого (2026-11-17; власник не схвалював): кількість PR у рядках 198–209 (19, з них 17 Ч) і поле «Залежить
від» — оцінка планувальника. Номери 198–199 є і в плані MVP (рядки зовнішнього рев'ю); номери з рішення власника
збережено, у посиланнях пишемо «рядок 198 плану MVP». Групування переліку MVP за модулями — за основною темою issue.
