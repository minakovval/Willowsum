import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "ws:list-state:";
/** Kept in memory when `sessionStorage` is unavailable (private window, blocked site data). */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    sessionStorage.setItem(PREFIX + key, value);
  } catch {
    // memory copy only
  }
}

interface Saved<T> {
  state: T;
  scrollY: number;
}

/**
 * CMP-13@PoC «Поведінка», AC2: the state of a list (page, page size, filters, sort — whatever the caller puts in
 * `state`) and the scroll position are restored when the user comes back to the list (a record opened and «назад»).
 * `key` names the list («transactions»). The state is kept for the browser tab only. Returns the state, a setter
 * (also stores the value at once, so a reload or a route change loses nothing) and nothing else: the scroll
 * position is saved when the list unmounts and restored after it mounts again.
 */
export function useRestoredListState<T>(
  key: string,
  initial: T,
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  const [saved] = useState<Saved<T>>(() => {
    try {
      const raw = read(key);
      if (raw) return JSON.parse(raw) as Saved<T>;
    } catch {
      // unreadable: start from the initial state
    }
    return { state: initial, scrollY: 0 };
  });
  const [state, setState] = useState<T>(saved.state);
  const latest = useRef(saved.state);
  const scroll = useRef(saved.scrollY);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        write(key, JSON.stringify({ state: value, scrollY: scroll.current }));
        return value;
      });
    },
    [key],
  );

  useEffect(() => {
    // The router may scroll to the top before this list unmounts, so the position is followed, not read at the end.
    if (scroll.current > 0) window.scrollTo(0, scroll.current);
    const follow = () => {
      scroll.current = window.scrollY;
    };
    window.addEventListener("scroll", follow, { passive: true });
    return () => {
      window.removeEventListener("scroll", follow);
      write(key, JSON.stringify({ state: latest.current, scrollY: scroll.current }));
    };
  }, [key]);

  return [state, set] as const;
}
