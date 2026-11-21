/**
 * IMP-08@PoC c): the one-shot intent to apply a batch. Only a click of «Застосувати» (on the review step, or on the result
 * step itself) sets it; the result step takes it once. Opening `/import/<batch>/result` by address, a reload or back/forward
 * has no intent, so it never writes transactions by itself. Kept in memory on purpose: a reload clears it.
 */
const armed = new Set<string>();

export const armApply = (batchId: string): void => {
  armed.add(batchId);
};

/** `true` once after `armApply`; the intent is spent by the call. */
export const takeApplyIntent = (batchId: string): boolean => armed.delete(batchId);
