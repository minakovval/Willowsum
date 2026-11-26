# Ambiguity checks for new or reworded requirement text

**Створено:** 2026-11-26 · **Оновлено:** 2026-11-26

Read when you write or reword an FR, AC, EC or NFR item, a П-rule or a glossary entry (`change-requirement` §1,
item 6). Adapted from the `clarify` skill of [genkovich/sdd](https://github.com/genkovich/sdd) (MIT, © 2026
Kyrylo Genkov); owner decision 2026-11-26,
[log](../../../../docs/decisions/log/2026-11-26-owner-ambiguity-checks.md).

**The test for every class:** could two competent engineers read this item and build different things, or
write tests that disagree? If yes, the item is ambiguous.

## How to use it

1. Sweep only the items this batch adds or rewords (the source lines you change), plus the items they now
   contradict. Not the whole requirement.
2. For each finding, either fix it in the text (a number, a named rule, a sibling AC) or ask:
   - a real product question (direction, scope or release, legal or compliance, money, access,
     infrastructure) → «Open questions for the product owner» in the PR body; keep the old text (§1 item 1);
   - a small detail (format, rounding, default view, wording) → the lead decides and records it as a lead
     decision (§4), AGENTS.md «Ambiguity».
3. Never fix ambiguity by inventing scope: a clarification must follow from the owner's decision or from text
   that already exists (another item, a П-rule, the glossary, the canvas).
4. List what the sweep found and how each item ended under «Impact» in the PR body, one line per finding
   (class → item → fixed / owner question / lead decision). No findings → write «Ambiguity sweep: 0».

Fix in this order (highest impact first): conflict, under-specified AC, unmeasured NFR, undefined term, missing
role, scope creep, vague word, unstated assumption.

## The eight classes

### 1. Conflict

- **Spot it:** two statements that cannot both hold: two AC with incompatible outcomes, an item against a
  П-rule, an item of one slice against an item of a slice it depends on (`--impact`, `--show`), or a release
  tag that keeps an item the owner moved.
- **Resolve:** quote both lines and ask which wins; rewrite or remove the loser. Never leave both.

### 2. Under-specified AC

- **Spot it:** an AC covers only the happy path: silent on the error, the role without the right, a scoped
  member, the plan limit (`402 PLAN_LIMIT_REACHED`), the empty, loading or error state (AGENTS.md «UI»), or two
  users changing the same thing. Its «then» names one outcome where two are possible. Also an FR with no AC
  or EC that would let a test check it.
- **Resolve:** add a sibling AC or EC for the missing branch, in observable terms (what the user sees or what
  the data is), not status codes or SQL; or record that branch as out of scope for this release.

### 3. Unmeasured NFR

- **Spot it:** a performance, availability, size or retention item with an adjective instead of a number
  («швидко», «надійно», «великий обсяг») or with no way to measure it.
- **Resolve:** a number and how it is measured, taken from an NFR requirement when one exists; otherwise an
  owner question. Never keep the adjective.

### 4. Undefined term

- **Spot it:** a domain word used as if its meaning were settled but not in the glossary
  (`docs/requirements/00-general.md` §0.6) and not defined in the requirement: «активний», «підтверджений»,
  «основний рахунок»; or a glossary word used in a different sense.
- **Resolve:** use the glossary word; if the term is new, propose a one-sentence definition as an owner
  question or a glossary change in the same batch. Do not invent the definition silently.

### 5. Missing role

- **Spot it:** an item implies a role or scope that the access matrix (`00-general.md` §0.3) does not give, or
  says «система робить X» with nobody who triggers X; or a role in §0.3 that the item obviously affects
  appears in no AC.
- **Resolve:** name the role from §0.3 (no invented «user» or «admin») and add its AC, or record that the
  role is out of scope for this release.

### 6. Scope creep

- **Spot it:** an item quietly adds a capability, an integration or a screen that the target release does not
  have (`docs/requirements/README.md`, «Detail only the current release»), or a later release's feature in a
  PoC slice; new product features in PoC are frozen (`pr-pipeline` §2).
- **Resolve:** ask in or out. Out → move it with `--move` or drop it; in → it needs the owner's decision.

### 7. Vague word

- **Spot it:** «зазвичай», «кілька», «одразу», «зручно», «при потребі», «тощо», «і т. д.» in an FR or AC; a
  list that ends open; a limit without a number.
- **Resolve:** the concrete value or a closed list, taken from existing text, the canvas or a П-rule; a
  product value nobody has decided → owner question; a small detail → lead decision.

### 8. Unstated assumption

- **Spot it:** the item works only if something unsaid is true: the household has one currency, the bank
  statement always has a field, the user is online, a dated rate exists, data arrives in order.
- **Resolve:** state the assumption in the item or in `00-general.md` §0.7 («Припущення, що потребують
  підтвердження власника»), or add an EC for the case where it is false.
