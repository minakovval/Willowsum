/**
 * Entry point of the one backend image (ARC-02 FR 1): `node src/main.ts --role api|worker|scheduler`.
 * The role decides what runs; configuration comes only from the environment (FR 3).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mountApi } from "./api.ts";
import {
  createAccountDirectory,
  createAccountList,
  createAccountsServices,
  createCreditAccounts,
} from "./modules/accounts/index.ts";
import {
  createBudgetCategoryUsage,
  createBudgetObligations,
  createBudgetPlanSources,
  createBudgetServices,
} from "./modules/budget/index.ts";
import { createCashflowServices } from "./modules/cashflow/index.ts";
import { createAuditLog } from "./modules/audit/index.ts";
import { createCategoriesServices, createCategoryDirectory } from "./modules/categories/index.ts";
import {
  createCategorizationCategoryUsage,
  categorizationRulePorts,
  createCategorizationServices,
  createTransactionCategories,
} from "./modules/categorization/index.ts";
import { createFlagRuntimeFor } from "./modules/feature-flags/index.ts";
import { createDebtPayoffServices, createDebtPlannedExpenses } from "./modules/debt-payoff/index.ts";
import { createFileStorage, linkKey } from "./modules/file-storage/index.ts";
import { createImportRecipesReader, createImportRecipesServices } from "./modules/import-recipes/index.ts";
import { createImportSessionsServices } from "./modules/import-sessions/index.ts";
import { createGoalPlans, createGoalsServices, createGoalSpends } from "./modules/goals/index.ts";
import { createMerchantDirectory, createMerchantsServices } from "./modules/merchants/index.ts";
import {
  createRecurringCategoryUsage,
  createRecurringMonth,
  createRecurringServices,
} from "./modules/recurring/index.ts";
import {
  createFxRates,
  createFxReporting,
  officialDatedRates,
  startFxRatesRefresh,
} from "./modules/fx-rates/index.ts";
import {
  createHouseholdServices,
  createHouseholdSpaces,
  createSpaceKeys,
} from "./modules/household/index.ts";
import { createIdentityServices } from "./modules/identity/index.ts";
import { createLedger } from "./modules/ledger/index.ts";
import { createLiabilities } from "./modules/liabilities/index.ts";
import {
  createAccountPayments,
  createBudgetTransactions,
  createDuplicateCandidates,
  createTransactionCategoryUsage,
  createTransactionHistory,
  createGoalTransactions,
  createTransactionLookup,
  createTransactionRuleInputs,
  createTransactionRuleTags,
  createTransactionTexts,
  createImportedTransactions,
  createTransactionPendingPostings,
  createTransactionWalletUsage,
  createTransactionsServices,
  createTransferCandidates,
} from "./modules/transactions/index.ts";
import {
  createTransferMatchingServices,
  createTransferProposalSides,
} from "./modules/transfer-matching/index.ts";
import { createDuplicateCheck, createDuplicateMatchingServices } from "./modules/duplicate-matching/index.ts";
import { systemClock } from "./platform/adapters/index.ts";
import { captchaVerifier } from "./platform/adapters/captcha/index.ts";
import { keyManagement } from "./platform/adapters/kms/index.ts";
import {
  ensureBucket,
  memoryObjectStorage,
  s3ObjectStorage,
} from "./platform/adapters/object-storage/index.ts";
import { mailSender } from "./platform/adapters/mail/index.ts";
import { ConfigError, loadConfig, type Config } from "./platform/config/config.ts";
import { CONTEXT_ROLE } from "./platform/db/isolation.ts";
import { ModuleDatabases } from "./platform/db/module-db.ts";
import { PROBE_ROLE, pendingMigrations, readMigrations } from "./platform/db/migrate.ts";
import { moduleRoleName, topologicalOrder, type ModuleRules } from "./platform/modules/rules.ts";
import { scheduleDaily } from "./platform/process/daily.ts";
import { createLifecycle } from "./platform/process/lifecycle.ts";
import { createWorker } from "./platform/queue/index.ts";
import { createApiRateLimits } from "./platform/http/rate-limit.ts";
import { createListTotals } from "./platform/lists/list-total.ts";
import { buildServer } from "./platform/process/server.ts";
import { logEvent } from "./platform/telemetry/signals.ts";
import { startTelemetry } from "./platform/telemetry/telemetry.ts";
import {
  contextPoolOptions,
  flagReloadHealthLog,
  modulePoolOptions,
  modulePoolSize,
  readinessCheck,
  bulkActionsServicesFor,
  schedulerDailyTasks,
  workerQueues,
} from "./wiring.ts";

const rules = JSON.parse(
  readFileSync(new URL("../module-rules.json", import.meta.url), "utf8"),
) as ModuleRules;
const modules = topologicalOrder(rules);
const { values } = parseArgs({ options: { role: { type: "string", default: "" } } });

let config: Config;
try {
  config = loadConfig(process.env, values.role, modules);
} catch (error) {
  // The message names variables only (ConfigError); nothing else is printed.
  console.error(error instanceof ConfigError ? error.message : "Configuration error");
  process.exit(1);
}

// Telemetry first, so everything after it is traced (ARC-09; every role). Its exporter is configuration only.
const telemetry = startTelemetry({
  mode: config.telemetry.mode,
  role: config.role,
  environment: config.telemetry.environment,
  ...(config.telemetry.otlp ? { otlp: config.telemetry.otlp } : {}),
});

const expected = readMigrations({
  modules,
  modulesDir: fileURLToPath(new URL("./modules", import.meta.url)),
});
const probe = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: PROBE_ROLE,
  password: config.database.probePassword,
  ssl: config.database.ssl,
  max: 1,
  connectionTimeoutMillis: 2_000,
});
// An idle client that loses its connection (database restart, failover) must not crash the process: the
// next readiness check simply reports «не готовий». Nothing about the error is logged (it holds connection details).
probe.on("error", () => undefined);

const connection = {
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  ssl: config.database.ssl,
};
// Each module's own pool and role (ARC-01); the API serves module routes through them (ARC-07).
const databases = new ModuleDatabases({
  connectionFor: (module) => ({
    ...connection,
    user: moduleRoleName(module),
    password: config.database.modulePasswords.get(module) ?? "",
    // The flag check must never hang on the database (CICD-06 FR 3).
    ...modulePoolOptions(module),
  }),
  context: {
    ...connection,
    user: CONTEXT_ROLE,
    password: config.database.contextPassword,
    ...contextPoolOptions(),
  },
  // The worker runs up to DEFAULT_CONCURRENCY jobs of one module at a time, each on its own connection.
  ...(modulePoolSize(config.role) ? { poolSize: modulePoolSize(config.role)! } : {}),
});

// Flags and kill switches (CICD-06): read from the database by the readiness probe and by requests, reloaded
// when older than 15 s.
const flags = createFlagRuntimeFor(databases.for("feature-flags"), {
  // Once when reloads start failing (by error class) and once when they recover — never on every attempt.
  onReloadHealth: flagReloadHealthLog,
});

const audit = createAuditLog(databases.for("audit"));
// Spaces (ACC-01 part c): the first space on the first sign-in, and the space of a session.
// Keys of spaces (ARC-06 FR 1; ADR-0012): the master key only through the KMS port, chosen by WS_PROVIDER_MODE. The live
// adapter (OCI Vault) is not built yet and fails closed: a deployed process makes no space without a key.
const kms = keyManagement(config.providerMode, () => ({}), { deployed: config.deployed });
const spaces = createHouseholdSpaces(databases.for("household"), audit, kms);

// Stored files (ARC-06 FR 4, NFR-01 FR 4; IMP-01 b): the S3-compatible storage and the key of signed links from the
// configuration (required in staging and production); locally and in CI without them, the process's memory and a key
// drawn at start (links then end with the process). Locally the bucket is made if missing (the `pnpm local:up` storage).
const s3 = config.files.s3;
// The scheduler too: its daily cleanup removes unapplied import batches with their originals (IMP-01 FR 20); and the
// worker: the parse step reads each statement's original (IMP-01 FR 5).
const filesRole = config.role === "api" || config.role === "scheduler" || config.role === "worker";
if (s3 && !config.deployed && filesRole) await ensureBucket(s3);
const filesConfigured = s3 !== undefined && config.files.linkKey !== undefined;
// A deployed process never keeps a space's files in memory: without the storage it serves none (fail closed).
if (config.deployed && !filesConfigured && filesRole)
  logEvent("files.storage_missing", "error", { "ws.module": "file-storage", "ws.role": config.role });
const files =
  filesRole && (filesConfigured || !config.deployed)
    ? createFileStorage({
        db: databases.for("file-storage"),
        audit,
        keys: createSpaceKeys(databases.for("household"), audit, kms),
        objects: s3 ? s3ObjectStorage(s3) : memoryObjectStorage(),
        linkKey: linkKey(config.files.linkKey ?? randomBytes(32)),
      })
    : undefined;

// Sign-up and sign-in (ACC-01): the provider ports chosen by WS_PROVIDER_MODE (ARC-05). In staging and production
// the configuration allows only the live adapters (ACC-01 FR 12: no server without CAPTCHA there).
const identity =
  config.role === "api"
    ? createIdentityServices({
        mail: mailSender(config.providerMode, () => ({
          apiKey: config.identity.mail!.apiKey,
          from: config.identity.mail!.from,
        })),
        captcha: captchaVerifier(config.providerMode, () => ({ secret: config.identity.captchaSecret! })),
        audit,
        webOrigin: config.identity.webOrigin,
        spaces,
        // ACC-01 FR 16: sign-up only for the family's addresses (required in staging and production).
        ...(config.identity.signUpAllowlist ? { signUpAllowlist: config.identity.signUpAllowlist } : {}),
      })
    : undefined;

// The password hashing binding loads now, not at the first sign-up: without it the api role does not start.
if (identity) {
  try {
    await identity.hasher.hash(identity.secrets.token());
  } catch (error) {
    logEvent("identity.hasher_unavailable", "error", {
      "ws.module": "identity",
      "error.type": error instanceof Error ? error.constructor.name : "Error",
    });
    process.exit(1);
  }
}

// BUD-07 a: proposals of regular payments from the transactions (transactions), grouped by merchant (merchants), none
// from a loan account (accounts); payments confirmed or added by hand name a category (categories) and an account
// (accounts); b: a charge is matched by its category (categorization), in another currency at the rate of its date
// (fx-rates). One instance for the recurring routes and the budget's month of charges (#567).
const recurring = createRecurringServices({
  history: createTransactionHistory(databases.for("transactions")),
  merchants: createMerchantDirectory(databases.for("merchants")),
  accounts: createAccountDirectory(databases.for("accounts")),
  categories: createCategoryDirectory({
    db: databases.for("categories"),
    audit,
    newId: randomUUID,
  }),
  transactionCategories: createTransactionCategories(databases.for("categorization")),
  fx: createFxReporting({ db: databases.for("fx-rates"), now: () => systemClock.now() }),
  audit,
  clock: systemClock,
  newId: randomUUID,
});

// BUD-05: savings goals; a part's account balance is the journal's balance of its wallet (accounts); «Витратити»
// reads the transaction (transactions) and its journal event (ledger). One instance for the goals routes and «План» of
// the budget (BUD-17).
const goals = createGoalsServices({
  accounts: createAccountDirectory(databases.for("accounts")),
  ledger: createLedger(databases.for("ledger")),
  transactions: createTransactionLookup(databases.for("transactions")),
  // «Подушка безпеки» and the list of «Витратити»: expenses and candidates (transactions), rates (fx-rates).
  reads: {
    transactions: createGoalTransactions(databases.for("transactions")),
    fx: createFxReporting({ db: databases.for("fx-rates"), now: () => systemClock.now() }),
    categorization: createTransactionCategories(databases.for("categorization")),
    categories: createCategoryDirectory({
      db: databases.for("categories"),
      audit,
      newId: randomUUID,
    }),
  },
  audit,
  clock: systemClock,
  newId: randomUUID,
});

const lifecycle = createLifecycle(config.shutdownTimeoutMs);
// Stop hooks run in reverse order: telemetry is flushed last, after the server and the pools.
lifecycle.onStop(() => telemetry.shutdown());
// NFR-14 FR 9: rate limits are off only by the explicit load-test setting (never in production, config.ts).
if (config.http.rateLimits !== "on") logEvent("rate_limits.disabled", "warn", { "ws.role": config.role });
const server = buildServer({
  // A protected route's caller is the session's account in its space (ACC-01 part c, ADR-0010).
  ...(config.role === "api"
    ? {
        api: (app) =>
          mountApi(app, {
            databases,
            entitlements: config.planEntitlements,
            flags,
            // Counters in this process: the configuration allows one API instance with them (NFR-14 FR 10).
            rateLimits: config.http.rateLimits === "on" ? createApiRateLimits() : "off",
            allowedOrigins: config.http.allowedOrigins,
            ...(identity ? { identity, spaces } : {}),
            // ACC-08: the space's settings write the rename into the space's own log.
            household: createHouseholdServices({ audit }),
            // FIN-01: accounts post «Початковий залишок» to the journal, keep a loan's and a card's terms in
            // liabilities, seal the number with the space's key and show balances at the NBU rate (fx-rates).
            accounts: createAccountsServices({
              ledger: createLedger(databases.for("ledger")),
              liabilities: createLiabilities(databases.for("liabilities"), audit),
              keys: createSpaceKeys(databases.for("household"), audit, kms),
              fx: createFxReporting({ db: databases.for("fx-rates"), now: () => systemClock.now() }),
              audit,
              clock: systemClock,
              newId: randomUUID,
              walletUsage: [createTransactionWalletUsage(databases.for("transactions"))],
              // FIN-01 EC4: a closing first finishes the account's transactions still in the transactions queue.
              pendingPostings: [
                createTransactionPendingPostings(databases.for("transactions"), {
                  accounts: createAccountDirectory(databases.for("accounts")),
                  ledger: createLedger(databases.for("ledger")),
                  audit,
                }),
              ],
            }),
            // FIN-03: a transaction is one journal event on the account's subaccount (accounts' directory); the
            // list totals convert at the official rate of each transaction's date (DAT-01, fx-rates); split parts
            // take categories of the space's tree (categories' directory); «Очікує» is behind its flag.
            transactions: createTransactionsServices({
              accounts: createAccountDirectory(databases.for("accounts")),
              ledger: createLedger(databases.for("ledger")),
              totals: createListTotals({
                rates: officialDatedRates(
                  createFxRates({ db: databases.for("fx-rates"), now: () => systemClock.now() }),
                ),
                now: () => systemClock.now(),
              }),
              audit,
              clock: systemClock,
              newId: randomUUID,
              categories: createCategoryDirectory({
                db: databases.for("categories"),
                audit,
                newId: randomUUID,
              }),
              flags,
              // A transfer in two currencies keeps the official rate of its date (FIN-03 FR 8).
              rates: (requests) =>
                createFxRates({ db: databases.for("fx-rates"), now: () => systemClock.now() }).rates(
                  requests,
                ),
              // FIN-03 FR 18: only a «Можливий дубль» is hidden, by duplicate-matching's rule.
              duplicates: createDuplicateCheck(),
              // BUD-12 FR 7: «Підтвердити» on a card whose category was changed elsewhere is refused.
              categoryOf: createTransactionCategories(databases.for("categorization")),
            }),
            // FIN-03 FR 12: «Можливий дубль» pairs from the space's transactions.
            duplicateMatching: createDuplicateMatchingServices({
              candidates: createDuplicateCandidates(databases.for("transactions")),
            }),
            // FIN-03 FR 5, FR 6: proposals of transfers from the space's transactions at the official rates.
            transferMatching: createTransferMatchingServices({
              candidates: createTransferCandidates(databases.for("transactions")),
              rates: (requests) =>
                createFxRates({ db: databases.for("fx-rates"), now: () => systemClock.now() }).rates(
                  requests,
                ),
            }),
            // DAT-03: bulk actions of the selection panels, with the same targets and actions as the worker's.
            bulkActions: bulkActionsServicesFor(audit, databases, systemClock, flags),
            // BUD-01 b: a transaction's category and its source, changed by hand (categorization).
            categorization: createCategorizationServices({
              transactions: createTransactionLookup(databases.for("transactions")),
              categories: createCategoryDirectory({
                db: databases.for("categories"),
                audit,
                newId: randomUUID,
              }),
              audit,
              // BUD-14 b: the category rules read the accounts, the merchants and the transactions' rule inputs.
              rules: categorizationRulePorts({
                accounts: createAccountDirectory(databases.for("accounts")),
                merchants: createMerchantDirectory(databases.for("merchants")),
                inputs: createTransactionRuleInputs(databases.for("transactions")),
                // BUD-14 b2: the tags action of a rule in «Застосувати до N наявних…».
                tags: createTransactionRuleTags({
                  db: databases.for("transactions"),
                  accounts: createAccountDirectory(databases.for("accounts")),
                  newId: randomUUID,
                  flags,
                }),
              }),
              // BUD-14 b2: when a run began and ended, and its 7 days of «Відмінити».
              clock: systemClock,
            }),
            // BUD-01: the category tree of the space; the system tree is written on first use. FR 12: a custom
            // category is deleted only while empty — every module that keeps category ids answers here (today the
            // split parts of transactions, the categorization's and the regular payments'; budget adds its own).
            categories: createCategoriesServices({
              audit,
              clock: systemClock,
              newId: randomUUID,
              usage: [
                createTransactionCategoryUsage(databases.for("transactions")),
                createCategorizationCategoryUsage(
                  databases.for("categorization"),
                  createTransactionLookup(databases.for("transactions")),
                ),
                createBudgetCategoryUsage(databases.for("budget")),
                createRecurringCategoryUsage(databases.for("recurring")),
              ],
            }),
            // BUD-02 a: the space's budget over the category tree, the accounts, the period's transactions with their
            // categories, each converted at the NBU rate of its date (fx-rates).
            budget: createBudgetServices({
              categories: createCategoryDirectory({
                db: databases.for("categories"),
                audit,
                newId: randomUUID,
              }),
              accounts: createAccountList(databases.for("accounts")),
              transactions: createBudgetTransactions(databases.for("transactions")),
              categorization: createTransactionCategories(databases.for("categorization")),
              fx: createFxReporting({ db: databases.for("fx-rates"), now: () => systemClock.now() }),
              audit,
              clock: systemClock,
              newId: randomUUID,
              // #567: the month's regular charges (recurring) and loans' monthly payments (accounts, liabilities) with
              // whether the month has a payment to the loan (transactions), at today's NBU rate (fx-rates).
              // BUD-17 a: «План» — the active goals' required contributions (goals), the saved payoff plans' extra
              // payments (debt-payoff) and the expected regular incomes (recurring), at today's NBU rate (fx-rates).
              planSources: createBudgetPlanSources({
                goals: createGoalPlans(databases.for("goals"), goals),
                debts: createDebtPlannedExpenses(
                  databases.for("debt-payoff"),
                  createCreditAccounts(databases.for("accounts")),
                ),
                fx: createFxReporting({ db: databases.for("fx-rates"), now: () => systemClock.now() }),
                // FR 1 «Надходження»: the month's expected regular incomes.
                recurring: createRecurringMonth(databases.for("recurring"), recurring),
                // #613: «План» off — «Бюджет» keeps the budget's own income plan.
                planEnabled: (householdId) => flags.isEnabled(householdId, "budget.plan"),
              }),
              // BUD-03 EC5: «Витратити з цілі» — a goal's spends leave «Можна витратити» (goals).
              goalSpends: createGoalSpends(databases.for("goals")),
              obligations: createBudgetObligations({
                recurring: createRecurringMonth(databases.for("recurring"), recurring),
                credit: createCreditAccounts(databases.for("accounts")),
                liabilities: createLiabilities(databases.for("liabilities"), audit),
                payments: createAccountPayments(databases.for("transactions")),
                fx: createFxReporting({ db: databases.for("fx-rates"), now: () => systemClock.now() }),
              }),
            }),
            // BUD-08 a: «Грошовий потік» over the category tree, the accounts, the period's transactions with their
            // categories, the proposed transfers (left out) and the NBU rate of each date (fx-rates).
            cashflow: createCashflowServices({
              categories: createCategoryDirectory({
                db: databases.for("categories"),
                audit,
                newId: randomUUID,
              }),
              accounts: createAccountList(databases.for("accounts")),
              transactions: createBudgetTransactions(databases.for("transactions")),
              categorization: createTransactionCategories(databases.for("categorization")),
              transfers: createTransferProposalSides({
                candidates: createTransferCandidates(databases.for("transactions")),
                rates: (requests) =>
                  createFxRates({ db: databases.for("fx-rates"), now: () => systemClock.now() }).rates(
                    requests,
                  ),
              }),
              fx: createFxReporting({ db: databases.for("fx-rates"), now: () => systemClock.now() }),
              clock: systemClock,
            }),
            // BUD-14 a: the merchant of a transaction from its description, renamed and merged for the space.
            merchants: createMerchantsServices({
              transactions: createTransactionTexts(databases.for("transactions")),
              audit,
              // BUD-12 FR 14: the suggested category of a merchant's group in «До розбору».
              categories: createTransactionCategories(databases.for("categorization")),
            }),
            recurring,
            // BUD-05: savings goals (one instance with «План» of the budget, above).
            goals,
            // BUD-19 a: «Борги» — the credit cards and loans (accounts) with their terms (liabilities) and debts (ledger).
            debtPayoff: createDebtPayoffServices({
              accounts: createCreditAccounts(databases.for("accounts")),
              liabilities: createLiabilities(databases.for("liabilities"), audit),
              ledger: createLedger(databases.for("ledger")),
              audit,
              clock: systemClock,
              newId: randomUUID,
            }),
            // IMP-06 a: parsing recipes of the space; the account binding's value sealed with the space's key.
            importRecipes: createImportRecipesServices({
              keys: createSpaceKeys(databases.for("household"), audit, kms),
              audit,
              clock: systemClock,
              newId: randomUUID,
            }),
            // IMP-01 b: import batches; each original is stored by file-storage (type by content, the space's key).
            ...(files
              ? {
                  importSessions: createImportSessionsServices({
                    files,
                    audit,
                    clock: systemClock,
                    newId: randomUUID,
                    // The parse step: the recipes and accounts a request may name, the key of the parsed rows.
                    parse: {
                      recipes: createImportRecipesReader(databases.for("import-recipes")),
                      accounts: createAccountDirectory(databases.for("accounts")),
                      keys: createSpaceKeys(databases.for("household"), audit, kms),
                    },
                    // IMP-01 FR 11: «Застосувати» — module transactions writes the batch's rows (journal by hand-off).
                    apply: {
                      transactions: createImportedTransactions(databases.for("transactions"), {
                        accounts: createAccountDirectory(databases.for("accounts")),
                        ledger: createLedger(databases.for("ledger")),
                        audit,
                        newId: randomUUID,
                        now: () => systemClock.now(),
                      }),
                    },
                  }),
                }
              : {}),
            deployed: config.deployed,
          }),
      }
    : {}),
  hsts: config.deployed,
  trustedProxyHops: config.http.trustedProxyHops,
  // Schema at least this version; for the api role fresh flags too (before that every module answers 503).
  readiness: readinessCheck({
    role: config.role,
    pendingMigrations: async () => {
      const client = await probe.connect();
      try {
        return (await pendingMigrations(client, expected)).length;
      } finally {
        client.release();
      }
    },
    flags,
  }),
});

lifecycle.onStop(() => probe.end());
lifecycle.onStop(() => databases.end());
lifecycle.onStop(() => server.close());
// The worker role (ARC-04, ARC-02 FR 1–2): the job queue and outbox of every module that has them, over every space.
// It holds no state of its own: jobs and leases are in the database. On stop, interrupted jobs go back to the queue.
if (config.role === "worker") {
  const worker = createWorker({
    ...workerQueues(
      databases,
      flags,
      // IMP-01 FR 5: the parse of import batches' files. Locally without S3 the worker's storage is its own memory, so
      // it finds no original the API process stored (the file is refused as FILE_MISSING); `pnpm local:up` has S3.
      files ? { files, keys: createSpaceKeys(databases.for("household"), audit, kms) } : undefined,
    ),
    households: () => spaces.spaceIds(),
    moduleAvailable: (module) => flags.isModuleAvailable(module),
  });
  worker.start();
  lifecycle.onStop(() => worker.stop());
  logEvent("worker.started", "info", { "ws.role": config.role });
}
// The scheduler's daily tasks (ADR-0010).
if (config.role === "scheduler") {
  // The owner's alert letters (VAL-05 FR 4, FIN-04 FR 10; owner decision 2026-11-12: PoC alerts are app emails).
  const alertMail = config.alerts.email
    ? {
        to: config.alerts.email,
        mail: mailSender(config.providerMode, () => ({
          apiKey: config.identity.mail!.apiKey,
          from: config.identity.mail!.from,
        })),
      }
    : undefined;
  // Identity's cleanup (NFR-12@PoC: unconfirmed accounts after 30 days) and the ledger's integrity check with the
  // owner's letter (FIN-04 FR 9, FR 10; without a recipient, an «error» event instead).
  const daily = scheduleDaily(
    schedulerDailyTasks({
      databases,
      audit,
      spaces,
      // ARC-06 FR 3: the keys of spaces follow a master key rotation in the background.
      spaceKeys: createSpaceKeys(databases.for("household"), audit, kms),
      // IMP-01 FR 20: unapplied import batches go with their originals 30 days after their last action. Locally
      // without S3 the scheduler's storage is its own memory: the rows go, the API process's objects end with it.
      ...(files ? { files } : {}),
      ...(alertMail ? { alertMail } : {}),
    }),
  );
  lifecycle.onStop(() => daily.stop());
  // VAL-05 FR 4: without the owner's address no alert letter can go out; say so loudly (the address is never logged).
  if (config.deployed && !config.alerts.email)
    logEvent("alerts.recipient_missing", "error", { "ws.module": "fx-rates", "ws.role": config.role });
  // Exchange rates once a day with retries (VAL-05): the NBU in deployed environments, synthetic locally and in CI.
  // Not wrapped in runScheduled: it logs every failed run at error level, and VAL-05 FR 4 keeps the error level for
  // 24 h without a successful update; a failed attempt is a warning.
  const fx = startFxRatesRefresh({
    db: databases.for("fx-rates"),
    mode: config.providerMode,
    // VAL-05 FR 4 (owner decision 2026-11-12): one letter to the product owner per stale period, via the mail adapter.
    ...(alertMail ? { alertMail } : {}),
    report: (event) => {
      const attributes = { "ws.module": "fx-rates", "ws.job.name": "fx-rates.refresh" };
      // FR 4, AC2: 24 h without a successful update is an error-level event in the server log.
      if (event.kind === "stale")
        logEvent("fx_rates.stale", "error", {
          ...attributes,
          "ws.provider.attempts": Math.min(event.failures, 100),
        });
      else if (event.kind === "updated")
        logEvent("fx_rates.updated", "info", { ...attributes, "ws.outcome": "success" });
      else if (event.kind === "failed")
        logEvent("fx_rates.attempt_failed", "warn", { ...attributes, "error.type": event.errorClass });
      else if (event.kind === "alert-sent") logEvent("fx_rates.alert_sent", "info", attributes);
      else logEvent("fx_rates.alert_failed", "error", { ...attributes, "error.type": event.errorClass });
    },
  });
  lifecycle.onStop(() => fx.stop());
}

await server.listen({ host: config.host, port: config.port });
logEvent("process.started", "info", { "ws.role": config.role });
/**
 * Lifecycle lines written directly to stdout, outside telemetry: «stopped» comes after telemetry has stopped.
 * Same base fields as the server log lines of `WS_TELEMETRY=off` (time, severity, event), no personal data.
 */
const lifecycleLine = (event: string, severity: "INFO" | "WARN", fields: Record<string, string | number>) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), severity, event, ...fields }));
lifecycleLine("started", "INFO", { role: config.role, port: config.port });

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void lifecycle.stop().then((outcome) => {
      lifecycleLine("stopped", outcome === "clean" ? "INFO" : "WARN", { role: config.role, outcome });
      process.exit(outcome === "clean" ? 0 : 1);
    });
  });
}
