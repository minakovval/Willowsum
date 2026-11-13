/** A command of scripts/ledger-balances.ts (ARC-11 «Баланси і продуктивність»: the rebuild of the balance cache). */
export interface RebuildCommand {
  readonly kind: "rebuild";
  readonly householdId: string;
  /** One account of the space, or every account when absent. */
  readonly accountId?: string;
}

export const LEDGER_BALANCES_USAGE = `Usage: node scripts/ledger-balances.ts rebuild <space uuid> [<ledger account uuid>]
  rebuild <space>             rebuilds the daily balance cache of every account of the space from its postings
  rebuild <space> <account>   the same for one ledger account
Prints the numbers of accounts and cached days; no amounts.`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseLedgerBalancesCommand(args: readonly string[]): RebuildCommand {
  const [command, householdId, accountId, ...rest] = args;
  if (command !== "rebuild") throw new Error(`unknown command: ${command ?? "(none)"}`);
  if (rest.length > 0) throw new Error("too many arguments");
  for (const id of [householdId, accountId])
    if (id !== undefined && !UUID_RE.test(id)) throw new Error("a space and an account are UUIDs");
  if (householdId === undefined) throw new Error("rebuild needs a space UUID");
  return accountId === undefined
    ? { kind: "rebuild", householdId }
    : { kind: "rebuild", householdId, accountId };
}
