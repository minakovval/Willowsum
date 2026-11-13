# Deploy steps 4–8: build, DNS, deploy, post-deploy check, rollback (full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `deploy` SKILL.md without change (owner, 2026-11-13). Read when you actually build, deploy, change DNS, check or roll back.

## 4. Build

The production web build is `pnpm --filter @willowsum/web build:production` (mode `production`). It needs
`VITE_CAPTCHA_SITE_KEY` (the public Cloudflare Turnstile site key) and fails without a well-formed key;
`pnpm build` (mode `ci`) is for local and CI only (`apps/web/README.md`). **Перевірити, коли буде сервер:**
the API image build, the registry and how the image reaches the server (CICD-05 FR1 requires an image from
`main` with all checks green; nothing is written yet).

## 5. DNS

The record for `willowsum.mina.yachts` is in the `mina.yachts` zone at Spaceship, the owner's account (shared
with another project). The agent never changes DNS: write a browser task for the owner's local session
(`browser-task` skill, `docs/ops/browser-tasks/NN-<topic>.md`), update `docs/ops/integrations.md` in the same
PR, and note that production DNS changes need approval (section 3). Do not touch other records of the zone.
The server's public address comes from the infrastructure outputs after the owner-approved apply;
**перевірити, коли буде сервер:** the record type and value, and whether a CDN stands in front (`infra/start`
lists it as not done).

## 6. Deploy

CICD-05@PoC describes the intended flow: a manual start by the owner, confirmed with the first 7 characters of
the commit hash; a DB restore point first; migrations as a separate step before the code; the new version
beside the old one, traffic switched after «ready»; smoke tests (sign-in, a record in a test space, a
background job); automatic return to the previous version on failure; a release log entry (version, time,
who approved, PRs). **Перевірити, коли буде сервер:** the actual workflow and commands do not exist yet; do
not run or invent them. Agents act in production only through the allowlisted pipeline actions after owner
approval (CICD-08 FR3) and never read the production database, secrets or server shell.

## 7. Post-deploy check

PoC has no Grafana, no staging and no external alive-check (owner, 2026-11-12; CICD-07@PoC FR4–5): open the
app at `https://willowsum.mina.yachts` and look at the structured logs (one JSON line per record on standard
output, `WS_TELEMETRY=off`; kept 30 days, only the owner can read them). The owner learns of a failure by
opening the app. An agent reads nothing in production; it uses lines the owner passes it, if they contain no
personal data. **Перевірити, коли буде сервер:** where to open the logs on the host.

## 8. Rollback

Code rolls back to the previous version without rolling back the schema (migrations stay compatible with the
previous code, CICD-05 FR5); target ≤ 5 min. Rolling back is an allowlisted action run by the pipeline after
owner approval (CICD-08 FR3), never by hand on the server. **Перевірити, коли буде сервер:** the command or
workflow. The DB restore point and the off-site copies (Frankfurt) are for data loss, not for a code rollback.
