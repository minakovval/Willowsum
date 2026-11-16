/** The options of scripts/nbu-banks.ts (FIN-01@PoC FR 4: the update of the built-in directory of NBU banks). */
export interface NbuBanksCommand {
  /** A downloaded NBU JSON; absent — download from the file's source URL. */
  readonly from?: string;
  readonly asOf?: string;
  /** Write nothing; exit 1 when the file would change. */
  readonly check: boolean;
  /** Download even when the directory is already from today's list (owner, 2026-11-16: at most once a day). */
  readonly force: boolean;
}

export const NBU_BANKS_USAGE = `Usage: node scripts/nbu-banks.ts [--from <NBU JSON>] [--as-of YYYY-MM-DD] [--check] [--force]
  --from <file>   read a downloaded NBU list instead of downloading it
  --as-of <date>  the date of the list (default: today; with --check — the file's own date)
  --check         write nothing; exit 1 when the file would change
  --force         download even when the directory is already from today's list`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseNbuBanksCommand(args: readonly string[]): NbuBanksCommand {
  let from: string | undefined;
  let asOf: string | undefined;
  let check = false;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--check") check = true;
    else if (arg === "--force") force = true;
    else if (arg === "--from" || arg === "--as-of") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i++;
      if (arg === "--from") from = value;
      else if (!DATE_RE.test(value)) throw new Error("--as-of is YYYY-MM-DD");
      else asOf = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return { ...(from !== undefined ? { from } : {}), ...(asOf !== undefined ? { asOf } : {}), check, force };
}

/** Today's date in Kyiv (the NBU publishes by Kyiv dates), YYYY-MM-DD. */
export function kyivDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(now);
}

/**
 * Whether the script may call bank.gov.ua now (owner, 2026-11-16: requests to the NBU at most once a day): only to
 * download (no --from), and not when the directory is already from today's list, unless --force.
 */
export function mayDownload(command: NbuBanksCommand, fileAsOf: string, today: string): boolean {
  if (command.from !== undefined) return false;
  return command.force || fileAsOf !== today;
}

/** The date the new file carries: --as-of; under --check the file's own date (so an unchanged list passes); else today. */
export function listDate(command: NbuBanksCommand, fileAsOf: string, today: string): string {
  return command.asOf ?? (command.check ? fileAsOf : today);
}
