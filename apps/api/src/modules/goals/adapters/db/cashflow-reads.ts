import { Money } from "@willowsum/domain-kernel";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";

/** A goal's own account («Окремий рахунок цілі») and the days it was the goal's (BUD-08@PoC FR 5). */
export interface GoalOwnAccount {
  readonly goalId: string;
  readonly accountId: string;
  readonly createdOn: string;
  /** null — the goal is open. */
  readonly closedOn: string | null;
}

/** A «Внести» mark (BUD-05@PoC FR 6) in the goal's currency on its day. */
export interface GoalContributionMark {
  readonly goalId: string;
  readonly amount: Money;
  readonly date: string;
}

/** BUD-08@PoC FR 5: every own-account goal of the space, closed ones too (`goals_by_account`). */
export async function ownAccountGoals(
  q: HouseholdQueryRunner,
  householdId: string,
): Promise<GoalOwnAccount[]> {
  const { rows } = await q.query<{
    id: string;
    account_id: string;
    created_on: string;
    closed_on: string | null;
  }>(
    `SELECT id, account_id, to_char(created_on, 'YYYY-MM-DD') AS created_on, to_char(closed_on, 'YYYY-MM-DD') AS closed_on
       FROM goals
      WHERE household_id = $1 AND part_kind = 'account' AND account_id IS NOT NULL
      ORDER BY created_at, id`,
    [householdId],
  );
  return rows.map((r) => ({
    goalId: r.id,
    accountId: r.account_id,
    createdOn: r.created_on,
    closedOn: r.closed_on,
  }));
}

/**
 * BUD-08@PoC FR 5: the «Внести» marks of the space from `from` to `to` (both included), closed goals' too — by goal, on
 * `contributions_by_goal` (household, goal, day).
 */
export async function contributionMarks(
  q: HouseholdQueryRunner,
  householdId: string,
  from: string,
  to: string,
): Promise<GoalContributionMark[]> {
  const { rows } = await q.query<{ goal_id: string; amount: string; currency: string; date: string }>(
    `SELECT c.goal_id, c.amount::text AS amount, c.currency, to_char(c.contributed_on, 'YYYY-MM-DD') AS date
       FROM goals g
       JOIN contributions c ON c.household_id = g.household_id AND c.goal_id = g.id
      WHERE g.household_id = $1 AND c.contributed_on BETWEEN $2::date AND $3::date
      ORDER BY c.contributed_on, c.created_at, c.id`,
    [householdId, from, to],
  );
  return rows.map((r) => ({ goalId: r.goal_id, amount: Money.of(r.amount, r.currency), date: r.date }));
}
