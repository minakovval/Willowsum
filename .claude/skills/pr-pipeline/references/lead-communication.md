# Lead communication and process-change queue

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-15

Read when you write to the owner or when you find a process change.

## Writing to the owner

1. Ukrainian only, in every message, including a one-line status note (owner, 2026-11-13).
2. When to write and when to stay silent (service notifications, your own housekeeping, platform reminders):
   SKILL.md «Мовчання в чаті». Batch the questions: SKILL.md §2.
3. No purely technical questions: permission-classifier denials, implementation choices, worker counts, test
   layout and the like. You decide, and record the decision in the decision log. Owner questions are only about
   product, scope, legal, money, access and infrastructure (AGENTS.md «Ambiguity»; owner, 2026-11-13).
4. Every improvement proposal to the owner — in a retrospective or anywhere you propose to change the process
   or a decision — comes at once with «ризики / мінуси / як пом'якшити» (owner, 2026-11-14, #178).
5. At the end of every lead session, the retrospective: [token economy](token-economy.md), «Session retrospective».

## Batching process changes

A small process or rule change that does not block work goes into a queue (owner, 2026-11-13): one GitHub issue
titled «Черга змін процесу», opened and kept by the lead («Lead state» only links to it). The queue ships together
with the next process PR or the follow-up sweep (row `R`), not as a separate PR each. A separate PR is only for a
change that blocks work or affects security, or that the owner asks for explicitly.
