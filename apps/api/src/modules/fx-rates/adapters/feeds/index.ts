import {
  selectImplementation,
  type ProviderImplementations,
  type ProviderMode,
} from "../../../../platform/adapters/index.ts";
import type { FxRateFeed } from "../../application/index.ts";
import { nbuRateFeed, type NbuFeedOptions } from "./nbu.ts";
import { syntheticRateFeed } from "./synthetic.ts";

export { NBU_BASE_URL, OFFICIAL_RATES_PORT, nbuRateFeed, parseNbuRates } from "./nbu.ts";
export type { NbuFeedOptions } from "./nbu.ts";
export { SYNTHETIC_CURRENCIES, syntheticRateFeed } from "./synthetic.ts";

/** Both implementations of the feed (ARC-05 FR 2). PoC has one working source, the NBU (VAL-05 FR 3). */
export const FX_RATE_FEEDS: ProviderImplementations<FxRateFeed, NbuFeedOptions> = Object.freeze({
  test: syntheticRateFeed,
  live: nbuRateFeed,
});

/** The implementation the configuration selects (`WS_PROVIDER_MODE`; `test` unless set to `live`). */
export function fxRateFeed(mode: ProviderMode, liveOptions: () => NbuFeedOptions = () => ({})): FxRateFeed {
  return selectImplementation(mode, FX_RATE_FEEDS, liveOptions);
}
