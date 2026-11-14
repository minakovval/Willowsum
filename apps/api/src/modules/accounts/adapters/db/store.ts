import { Decimal } from "@willowsum/domain-kernel";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import type {
  AccountsListTx,
  AccountsTx,
  DuplicateCandidate,
  StoredAccount,
  StoredOwner,
  StoredSubaccount,
} from "../../application/index.ts";

/** The accounts schema through the module's own role (migrations/0001_accounts.sql). The row policy binds the space; SQL filters it too. */

/** NUMERIC(38,18) comes back with 18 decimals; rates and shares are kept as canonical decimal strings. */
const decimal = (text: string | null) => (text === null ? null : new Decimal(text).toFixed());

interface AccountRow {
  id: string;
  kind: StoredAccount["kind"];
  name: string;
  institution_name: string | null;
  institution_country: string | null;
  institution_key: string;
  number_last4: string | null;
  number_sealed: string | null;
  note: string | null;
  annual_rate: string | null;
  deposit_opened_on: string | null;
  deposit_matures_on: string | null;
  opened_on: string;
  status: StoredAccount["status"];
  closed_on: string | null;
  source: StoredAccount["source"];
}

// Dates as text, so no time zone of the driver touches them.
const ACCOUNT_COLUMNS = `id, kind, name, institution_name, institution_country, institution_key, number_last4,
  number_sealed, note, annual_rate::text AS annual_rate, deposit_opened_on::text AS deposit_opened_on,
  deposit_matures_on::text AS deposit_matures_on, opened_on::text AS opened_on, status,
  closed_on::text AS closed_on, source`;

function account(row: AccountRow): StoredAccount {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    institutionName: row.institution_name,
    institutionCountry: row.institution_country,
    institutionKey: row.institution_key,
    numberLast4: row.number_last4,
    numberSealed: row.number_sealed,
    note: row.note,
    annualRate: decimal(row.annual_rate),
    depositOpenedOn: row.deposit_opened_on,
    depositMaturesOn: row.deposit_matures_on,
    openedOn: row.opened_on,
    status: row.status,
    closedOn: row.closed_on,
    source: row.source,
  };
}

interface SubaccountRow {
  id: string;
  account_id: string;
  currency: string;
  position: number;
  ledger_account_id: string;
  balance_date: string;
}

const SUBACCOUNT_COLUMNS = `id, account_id, currency, position, ledger_account_id, balance_date::text AS balance_date`;

function subaccount(r: SubaccountRow): StoredSubaccount {
  return {
    id: r.id,
    accountId: r.account_id,
    currency: r.currency,
    position: r.position,
    ledgerAccountId: r.ledger_account_id,
    balanceDate: r.balance_date,
  };
}

export function accountsTx(q: ModuleQueryRunner): AccountsTx {
  return {
    async lockCreations(householdId) {
      await q.query(`SELECT pg_advisory_xact_lock(hashtext('accounts:create'), hashtext($1))`, [householdId]);
    },
    async duplicateCandidates(householdId, institutionKey, last4) {
      const { rows } = await q.query<{
        id: string;
        name: string;
        institution_name: string | null;
        number_last4: string;
        number_sealed: string | null;
        currencies: string[];
      }>(
        `SELECT a.id, a.name, a.institution_name, a.number_last4, a.number_sealed,
                array(SELECT s.currency FROM subaccounts s
                       WHERE s.household_id = a.household_id AND s.account_id = a.id ORDER BY s.position) AS currencies
           FROM accounts a
          WHERE a.household_id = $1 AND a.institution_key = $2 AND a.number_last4 = $3
          ORDER BY a.created_at, a.id`,
        [householdId, institutionKey, last4],
      );
      return rows.map((r): DuplicateCandidate => ({
        id: r.id,
        name: r.name,
        institutionName: r.institution_name,
        numberLast4: r.number_last4,
        numberSealed: r.number_sealed,
        currencies: r.currencies,
      }));
    },
    async insertAccount(householdId, a) {
      await q.query(
        `INSERT INTO accounts (household_id, id, kind, name, institution_name, institution_country, institution_key,
           number_last4, number_sealed, note, annual_rate, deposit_opened_on, deposit_matures_on, opened_on, status,
           source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          householdId,
          a.id,
          a.kind,
          a.name,
          a.institutionName,
          a.institutionCountry,
          a.institutionKey,
          a.numberLast4,
          a.numberSealed,
          a.note,
          a.annualRate,
          a.depositOpenedOn,
          a.depositMaturesOn,
          a.openedOn,
          a.status,
          a.source,
        ],
      );
    },
    async insertSubaccount(householdId, s) {
      await q.query(
        `INSERT INTO subaccounts (household_id, id, account_id, currency, position, ledger_account_id, balance_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [householdId, s.id, s.accountId, s.currency, s.position, s.ledgerAccountId, s.balanceDate],
      );
    },
    async insertOwner(householdId, accountId, o) {
      await q.query(
        `INSERT INTO account_owners (household_id, account_id, owner_account_id, share, valid_from, valid_to)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [householdId, accountId, o.ownerAccountId, o.share, o.validFrom, o.validTo],
      );
    },
    async account(householdId, accountId) {
      const { rows } = await q.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE household_id = $1 AND id = $2`,
        [householdId, accountId],
      );
      return rows[0] ? account(rows[0]) : null;
    },
    async subaccounts(householdId, accountId) {
      const { rows } = await q.query<SubaccountRow>(
        `SELECT ${SUBACCOUNT_COLUMNS} FROM subaccounts WHERE household_id = $1 AND account_id = $2 ORDER BY position`,
        [householdId, accountId],
      );
      return rows.map(subaccount);
    },
    async lockAccount(householdId, accountId) {
      const { rows } = await q.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE household_id = $1 AND id = $2 FOR UPDATE`,
        [householdId, accountId],
      );
      return rows[0] ? account(rows[0]) : null;
    },
    async setStatus(householdId, accountId, status, closedOn) {
      await q.query(`UPDATE accounts SET status = $3, closed_on = $4 WHERE household_id = $1 AND id = $2`, [
        householdId,
        accountId,
        status,
        closedOn,
      ]);
    },
    async owners(householdId, accountId) {
      const { rows } = await q.query<{
        owner_account_id: string;
        share: string;
        valid_from: string;
        valid_to: string | null;
      }>(
        `SELECT owner_account_id, share::text AS share, valid_from::text AS valid_from, valid_to::text AS valid_to
           FROM account_owners WHERE household_id = $1 AND account_id = $2 ORDER BY valid_from, owner_account_id`,
        [householdId, accountId],
      );
      return rows.map((r): StoredOwner => ({
        ownerAccountId: r.owner_account_id,
        share: decimal(r.share)!,
        validFrom: r.valid_from,
        validTo: r.valid_to,
      }));
    },
  };
}

/** What «Гроші разом» and «Рахунки» read (FIN-01 FR 13, FR 14, FR 18, FR 22), through the module's own role. */
export function accountsListTx(q: ModuleQueryRunner): AccountsListTx {
  return {
    async listAccounts(householdId, filter) {
      const params: unknown[] = [householdId];
      const where = ["household_id = $1"];
      if (!filter.includeClosed) where.push(`status = 'active'`);
      if (filter.kinds) {
        params.push([...filter.kinds]);
        where.push(`kind = ANY($${params.length}::text[])`);
      }
      if (filter.after) {
        // After the cursor's account in the order (created, id); an id the space does not have gives no rows.
        params.push(filter.after.id);
        where.push(
          `(created_at, id) > (SELECT c.created_at, c.id FROM accounts c WHERE c.household_id = $1 AND c.id = $${params.length}::uuid)`,
        );
      }
      let limit = "";
      if (filter.limit !== null) {
        params.push(filter.limit);
        limit = ` LIMIT $${params.length}`;
      }
      const { rows } = await q.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE ${where.join(" AND ")} ORDER BY created_at, id${limit}`,
        params,
      );
      return rows.map(account);
    },
    async subaccountsOf(householdId, accountIds) {
      const { rows } = await q.query<SubaccountRow>(
        `SELECT ${SUBACCOUNT_COLUMNS} FROM subaccounts WHERE household_id = $1 AND account_id = ANY($2::uuid[])
          ORDER BY account_id, position`,
        [householdId, [...accountIds]],
      );
      return rows.map(subaccount);
    },
  };
}
