/** A command of scripts/erasure.ts (NFR-12@PoC FR 3, NFR-16@PoC FR 9; ADR-0013). */
export type ErasureCommand =
  | {
      readonly kind: "request";
      readonly subject: { readonly email: string } | { readonly accountId: string };
    }
  | { readonly kind: "run"; readonly requestId: string }
  | { readonly kind: "status" }
  | { readonly kind: "reapply" };

export const ERASURE_USAGE = `Usage: node scripts/erasure.ts <command>
  request --email <address> | --account <uuid>   record a person's request (30-day deadline)
  run <request uuid>                              erase the account and all its data (key last)
  status                                          every request, its deadline and days left
  reapply                                         after a restore: apply every completed erasure again
Needs the processes' configuration (WS_DB_*, module passwords), DATABASE_URL (the migration role: it lets the
erasure roles log in for this run only) and the erasure log (WS_ERASURE_LOG_DIR locally).`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseErasureCommand(argv: readonly string[]): ErasureCommand {
  const [command, ...rest] = argv;
  switch (command) {
    case "request": {
      const email = rest[0] === "--email" ? rest[1] : undefined;
      const account = rest[0] === "--account" ? rest[1] : undefined;
      if (rest.length !== 2 || (!email && !account))
        throw new Error("request: --email <address> | --account <uuid>");
      if (account !== undefined) {
        if (!UUID_RE.test(account)) throw new Error("request: --account takes a uuid");
        return { kind: "request", subject: { accountId: account } };
      }
      return { kind: "request", subject: { email: email! } };
    }
    case "run":
      if (rest.length !== 1 || !UUID_RE.test(rest[0]!)) throw new Error("run: <request uuid>");
      return { kind: "run", requestId: rest[0]! };
    case "status":
    case "reapply":
      if (rest.length !== 0) throw new Error(`${command}: no arguments`);
      return { kind: command };
    default:
      throw new Error("Unknown command");
  }
}
