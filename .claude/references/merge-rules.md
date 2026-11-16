# Merge conditions and owner approval (AGENTS.md step 7, full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16

Read when you merge a PR, write an «Owner decision» section, a PR acts on the cloud or production, or you decide
which reviews a PR gets («Review tiers» below).

7. The lead merges the PR (squash) only when CI is green on the latest commit and both verdicts are Ready
   on the exact head: the review session gave «Ready» (plus the security review for sensitive areas) **on the
   commit being merged** (owner, 2026-11-13): before merging, compare the SHA each review names with the PR head; any later
   commit, even a small fix, needs a re-review of that fix (owner, 2026-11-12). PRs that change requirements, AGENTS.md or
   skills (label `owner-decision`) are merged only when the PR body records the owner's decision they implement (and the decision
   log in `docs/decisions/` has it). A purely mechanical sync of a list in AGENTS.md that a test requires needs no
   owner decision: only adding or removing a CI job name in the job list of step 6, or a skill's name with its
   own `description` line in «Skills»; nothing else qualifies. The PR body still notes it under «Owner
   decision» as a mechanical sync. Any change to a rule needs one (owner, 2026-11-13). For a docs-only PR that moves scope between releases, a security review (when needed) covers only the moved lines that state a protection (owner, 2026-11-12). The owner's approval on the PR is needed only for what acts on the
   cloud or production. It is either a comment from the owner's own GitHub account with a line that is exactly
   «Схвалюю» or «Approved», or the owner's decision from chat recorded in the PR body as a line
   `Рішення власника (YYYY-MM-DD): схвалено …` (owner, 2026-11-12). Agents never write a «Схвалюю» or
   «Approved» line, and write the body line only for a decision the owner actually gave. Approval is needed for: applying
   infrastructure (`tofu apply`), deploying or releasing to production, and changing the workflows that do
   this or the trust settings they use (OIDC trust, the production secrets store) or production DNS. Code
   that is only validated (infrastructure as code without apply, KMS and access rules described as code),
   CI check jobs and the local environment need no approval (owner, 2026-11-06). If the owner commented
   «stop» or asked a question on the PR, do not merge until they answer. Production releases still need the
   owner's approval. Never push to `main` directly: the free GitHub plan cannot block it, so the process
   is the protection.
   Once these conditions hold: do not ask the owner to confirm the merge; merge at once and tell the
   owner it is merged. **Merge on Ready, follow up separately** (owner, 2026-11-13): when both verdicts are Ready
   and only non-blocking findings remain, the lead merges; those items go to a follow-up PR or issue, not into
   the same PR, so they do not start another review round. A non-blocking finding never starts a commit before
   the merge. Exception, tier Фундамент only («Review tiers» below): a non-blocking item the reviewer marks as
   cheap and safe to fold in may still be added before merge, at the lead's choice (it then needs a re-review of
   that commit, as above). Рішення ведучого (2026-11-16; власник не схвалював; [log](../../docs/decisions/log/2026-11-16-owner-process-light.md)):
   the exception is dropped for the tiers Функціональність, Локальні інструменти and Документи; every such commit
   cost another review round. Exception for a merge from `main` (owner, 2026-11-13, #178): a docs-only PR not
   labelled `sensitive` whose files `main`'s changes do not touch needs no confirmation agent, but the lead's
   check and PR review ([merge checklist](../skills/pr-pipeline/references/merge-checklist.md), «The lead
   confirms a sync itself»); likewise a code PR without `sensitive` whose diff against its merge-base is byte-identical
   before and after the sync, with green CI on the new head (owner, 2026-11-16), and a `sensitive` PR whose sync is
   mechanical and brought no foundation file (owner, 2026-11-16, «1 б», [log](../../docs/decisions/log/2026-11-16-owner-process-light.md)),
   both in the [merge checklist](../skills/pr-pipeline/references/merge-checklist.md), «The lead confirms a sync
   itself». When a sync is needed at all: the same checklist, «Sync only when needed». Any other later commit still
   needs a re-review.

## Review tiers

Owner, 2026-11-16 («… PoC будувався як продакшн. тобто на нього будуть нашаровуватись нові функціональності, але база
має бути надійною», [log](../../docs/decisions/log/2026-11-16-owner-process-light.md)): the foundation stays
production-grade; the rest gets a lighter process. Рішення ведучого (2026-11-16; власник не схвалював;
[log](../../docs/decisions/log/2026-11-16-owner-process-light.md)): the four tiers and their reviews below; the
audit found most review time and tokens went where there was no risk (full rounds on mechanical syncs, three
security rounds with mutation testing on a developer-only script).

| Tier | Which PRs | Reviews |
| --- | --- | --- |
| **Фундамент** | A change in a foundation file (below), money and sums, a module's database schema, access rights, production infrastructure and deploy workflows | Unchanged: `review-pr` + `security-review`, mutation testing for critical modules |
| **Функціональність** | New screens and components, server parts of functions on top of the foundation that do not change its rules; any change of UI texts that touches `uk.ts`/`en.ts` (`review-pr` checks the strings equal the canvas «Тексти» block) | `review-pr`; `security-review` only when CI set `sensitive` because the PR touches the foundation |
| **Локальні інструменти** | `tools/local-env`, `tools/synthetic`, scripts for development only, test helpers — even when CI set `sensitive:pipeline` by path | `review-pr` + **one** `security-review` round without mutation testing; findings that do not concern production go to follow-ups |
| **Документи** | Plan statuses, README, the decision log (not requirement text); a canvas snapshot change only (`design/canvas/`, no code, no `uk.ts`/`en.ts`) | The lead checks it against the [merge checklist](../skills/pr-pipeline/references/merge-checklist.md); no separate review session |

The lead picks the tier from the diff and names it in the reviewer's brief; a PR in two tiers takes the stricter
one; in doubt — Фундамент (lead, 2026-11-16, same log). Requirement text, AGENTS.md and skills keep their own
review (`change-requirement` §8; `owner-decision` above). The owner's approval for cloud or production, the hard
rules and «Ready on the exact head» do not depend on the tier. UI texts (Рішення ведучого (2026-11-16; власник не
схвалював; #369)): a text change that touches `uk.ts`/`en.ts` is Функціональність, never Документи, since those files
are code (they fail `isDocsOnly`); only a snapshot-only change of `design/canvas/` is Документи.

### Foundation files

Owner, 2026-11-16 («1 б»): module roles, row policies and `ws_context`; the ledger (ARC-11, FIN-04); audit;
encryption and keys (ARC-06); sign-in and sessions (ACC-01, ACC-04); migrations; the queue and outgoing events
(ARC-04). Рішення ведучого (2026-11-16; власник не схвалював; [log](../../docs/decisions/log/2026-11-16-owner-process-light.md)):
these are the paths below (globs as in `tools/pr-rules/lib/paths.mjs`, one per line; the merge checklist reads this
block), plus `packages/domain-kernel` (the Money type); a path that a new module adds for the same job is added here
in the PR that adds it.

```foundation-paths
apps/api/src/platform/db/**
apps/api/src/platform/modules/**
apps/api/module-rules.json
apps/api/scripts/db-bootstrap.ts
apps/api/src/modules/access-scope/**
apps/api/src/modules/household/**
apps/api/src/modules/ledger/**
packages/domain-kernel/**
apps/api/src/modules/audit/**
apps/api/src/platform/adapters/kms/**
apps/api/src/platform/config/**
apps/api/src/modules/vault-items/**
apps/api/src/modules/file-storage/**
**/*crypt*
**/*cipher*
**/*kms*
**/*crypt*/**
**/*cipher*/**
**/*kms*/**
apps/api/src/modules/identity/**
**/auth/**
apps/api/src/platform/http/cookies.ts
apps/api/src/platform/http/origin.ts
apps/api/src/platform/http/rate-limit.ts
**/migrations/**
apps/api/scripts/migrate.ts
apps/api/scripts/check-migrations.ts
apps/api/scripts/check-schema.ts
apps/api/scripts/lib/migration-compat.ts
apps/api/schema-exemptions.json
apps/api/src/platform/queue/**
apps/api/src/platform/events/**
apps/api/src/modules/*/adapters/queue/**
apps/api/events.snapshot.json
```
