// The worker's side of the account binding (IMP-06@PoC FR 1; NFR-01@PoC FR 6; wave 2 row 41 part 3). Imported only by
// the parse worker (`imp06-account-open-guard.test.ts`): the value it returns must never be in the API thread.
import { openWithFieldOpener, wipeFieldOpener } from "../../../household/index.ts";
import type { OpenedAccountBinding } from "../../application/index.ts";
import type { SealedAccountBinding } from "./run.ts";

export class AccountBindingError extends Error {}

/**
 * The recipe's account value, opened with the space's key before the file is read; the key is wiped right after, on
 * success and on failure, so it is gone before any byte of the untrusted file is parsed. Any failure is an
 * `AccountBindingError` (the parse is refused as `ACCOUNT_BINDING`: it fails closed).
 */
export function openAccountBinding(
  binding: SealedAccountBinding | undefined,
): OpenedAccountBinding | undefined {
  if (!binding) return undefined;
  try {
    return { by: binding.by, value: openWithFieldOpener(binding.opener, binding.sealedValue) };
  } catch {
    throw new AccountBindingError();
  } finally {
    wipeFieldOpener(binding.opener);
  }
}
