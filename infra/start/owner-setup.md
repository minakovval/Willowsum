# Owner setup: Oracle Cloud account

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-06

One-time steps the owner does in their own browser (CICD-12: agents never hold the owner's accounts or
keys). Owner decision 2026-11-06: a **Pay As You Go** account, so free-tier resources stay free and are
not reclaimed as idle; the loss of the whole Madrid region is an accepted risk for now.

Never paste a password, key or token into a chat, an issue or a PR. When a step creates a secret, it goes
straight into your password manager or the secrets store.

## 1. Create the account (about 15 min)

1. Open https://signup.cloud.oracle.com and sign up with the owner's email.
2. **Home region: Spain Central (Madrid).** It cannot be changed later, and all data lives there (NFR-17).
3. Account type: Individual is fine for PoC. A card is needed for verification; nothing is charged.
4. Wait for the «Your account is ready» email and sign in to https://cloud.oracle.com.

## 2. Protect the sign-in

1. Profile (top right) → **My profile** → Security → enable **multi-factor authentication** (passkey or an
   authenticator app). Save the recovery codes in the password manager.
2. Keep the password only in the password manager.

## 3. Upgrade to Pay As You Go

1. Menu → **Billing & Cost Management** → **Upgrade and Manage Payment** → **Upgrade your account** →
   Pay As You Go. Confirm the card.
2. The upgrade can take a few hours; you get an email when it is done. Always Free resources stay free
   after it.

## 4. Budget alarm (protection against surprise costs)

1. **Billing & Cost Management** → **Budgets** → Create budget.
2. Scope: the whole tenancy; amount: **5 EUR per month**; alert at 50 % and 100 % of the *forecast*,
   sent to the owner's email.

## 5. Second region for the copies

1. Menu → **Governance & Administration** → **Region Management**.
2. Subscribe to **Germany Central (Frankfurt)**. This is where the off-site copies go (CICD-07 FR2).

## 6. Tell the lead

Write «акаунт OCI готовий» in the chat — no identifiers or keys are needed in the message. The next steps
(state bucket, state passphrase in the secrets store, OIDC trust between GitHub and the cloud) come with
the plan/apply PR, with exact instructions and the code for each setting, and need your approval comment
on that PR (AGENTS.md step 7).
