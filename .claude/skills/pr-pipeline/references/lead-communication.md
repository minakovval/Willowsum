# Lead communication and process-change queue

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Owner rules, 2026-11-13 (chat to the lead). Read when you write to the owner or when you find a process change.

## Writing to the owner

1. Ukrainian only, in every message, including a one-line status note.
2. No reports of agent steps (agent spawned, review started, commit pushed and so on).
3. Write only when: something is merged (PR link, one line; what is next); an owner decision is needed; there is a problem (a blocker, red CI that
   is not the PR's fault, a security issue). Batch the questions (SKILL.md §2).
4. No purely technical questions: permission-classifier denials, implementation choices, worker counts, test
   layout and the like. You decide, and record the decision in the decision log. Owner questions are only about
   product, scope, legal, money, access and infrastructure (AGENTS.md «Ambiguity»).

## Batching process changes

A small process or rule change that does not block work goes into a queue: one GitHub issue titled «Черга змін процесу»,
opened and kept by the lead («Lead state» only links to it). The queue ships together with the next process PR or the follow-up sweep (row `R`), not as a separate PR
each. A separate PR is only for a change that blocks work or affects security, or that the owner asks for
explicitly.
