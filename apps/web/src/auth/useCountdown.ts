import { useEffect, useState } from "react";

const secondsLeft = (deadline: number | null): number =>
  deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

/**
 * Whole seconds left until `deadline` (epoch ms), ticking once a second; 0 when there is no deadline or it has
 * passed. Used by «Надіслати ще раз» (ACC-01@PoC AC4) and the sign-in lockout (AC14).
 */
export function useCountdown(deadline: number | null): number {
  const [state, setState] = useState(() => ({ deadline, seconds: secondsLeft(deadline) }));
  // A new deadline takes effect in the same render (no frame with a stale, active button).
  let current = state;
  if (state.deadline !== deadline) {
    current = { deadline, seconds: secondsLeft(deadline) };
    setState(current);
  }
  useEffect(() => {
    if (deadline === null) return;
    const id = window.setInterval(() => {
      const seconds = secondsLeft(deadline);
      setState((s) => (s.deadline === deadline ? { deadline, seconds } : s));
      if (seconds === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [deadline]);
  return current.seconds;
}

/** The deadline `seconds` from now, or `null` for none. */
export const deadlineIn = (seconds: number | undefined): number | null =>
  seconds === undefined || seconds <= 0 ? null : Date.now() + seconds * 1000;
