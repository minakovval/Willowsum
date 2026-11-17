# Lead communication and process-change queue

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-17

Read when you write to the owner or when you find a process change.

## Writing to the owner

1. Ukrainian only, in every message, including a one-line status note.
2. When to write and when to stay silent: SKILL.md «Мовчання в чаті»; batching the questions: SKILL.md §2.
3. No purely technical questions (permission-classifier denials, implementation choices, worker counts, test
   layout and the like): decide and record it in the decision log. Owner questions are only about product, scope,
   legal, money, access and infrastructure (AGENTS.md «Ambiguity»).
4. Every improvement proposal to the owner — in a retrospective or anywhere you propose to change the process or a
   decision — comes at once with «ризики / мінуси / як пом'якшити».

## Batching process changes

A small process or rule change that does not block work goes into a queue: one GitHub issue
titled «Черга змін процесу», opened and kept by the lead («Lead state» only links to it). The queue ships together
with the next process PR, not as a separate PR each. A separate PR is only for a
change that blocks work or affects security, or that the owner asks for explicitly.

## Rule text

- A rule states the norm only: what to do and when. Who decided it, when, and which PR or incident caused it live
  in the decision log (`docs/decisions/log/`). A PR that edits a rule paragraph removes that paragraph's inline
  history («owner, date», issue and PR numbers, quotes) once the log has it. Each rule lives in one place.
- Size: `pr-pipeline/SKILL.md` with its `references/` and `.claude/references/` together stay within **1 060 lines**, not counting files only the external reviewer reads;
  a PR that would exceed it shortens other text in the same PR. How to check and apply: [process limits](../../../references/process-limits.md).
