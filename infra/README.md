# Infrastructure

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-06

Infrastructure as code for every environment of CICD-04 and both deployment profiles of ARC-08.

| Folder | Environment | Requirement | Status |
| --- | --- | --- | --- |
| [`local/`](local/README.md) | Local: development by agents and people, synthetic data | CICD-04 | Ready |
| — | CI: temporary environment per PR (`.github/workflows/pr-checks.yml`, job `local-env`) | CICD-04 | Ready (backing services) |
| [`start/`](start/README.md) | Staging and production on the «Старт» profile (Oracle Cloud Infrastructure, EU), OpenTofu | CICD-07, ARC-08 | Code and CI checks; not applied yet |
| `commercial/` | «Комерційний» profile | ARC-08 | Not started |

Rules for everything in this folder:

- Only standard technology available in any EU cloud: OCI images, PostgreSQL 17, S3-compatible storage,
  SMTP, OpenTelemetry (ARC-08). Cloud-specific services only behind adapters.
- No secrets in the repository: machines generate them (CICD-12).
- Images and actions pinned by version and digest (CICD-03); licences from the allowed list (CICD-02).
- Applying infrastructure (`tofu apply`), production deploys, and changes to the workflows that do them or
  to their trust settings (OIDC, production secrets store, production DNS) need the owner's approval
  comment on the PR (`AGENTS.md`). Code that is only validated here does not.
