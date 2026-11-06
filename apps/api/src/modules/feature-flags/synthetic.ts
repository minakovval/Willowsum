// Synthetic test-space marks (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
import { defineSyntheticTable } from "@willowsum/synthetic";

export const synthetic = [
  defineSyntheticTable({
    table: "feature_flags.test_households",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      // History first (unmarked), the last row is the current mark: at most one current row per space.
      for (let i = 0; i < count; i++) {
        const marked = rng.instant("2026-01-01T00:00:00Z", 200);
        const current = i === count - 1;
        yield {
          id: rng.uuid(),
          household_id: household.id,
          marked_at: marked,
          unmarked_at: current ? null : new Date(Date.parse(marked) + 86_400_000).toISOString(),
        };
      }
    },
  }),
];
