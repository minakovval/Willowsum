import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "ws:list-state:";
/** Kept in memory when `sessionStorage` is unavailable (private window, blocked site data). */
const memory = new Map<string, string>();

function read(key: string): string | null {
  // A value kept in memory is one the storage refused: it is newer than anything stored.
  const kept = memory.get(key);
  if (kept !== undefined) return kept;
  try {
    return sessionStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    sessionStorage.setItem(PREFIX + key, value);
    memory.delete(key);
  } catch {
    memory.set(key, value);
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
 * position is saved when the list unmounts and restored after it mounts again — once `ready` (default: at once), so a
 * list that loads its rows passes `ready` when they are on screen.
 */
export function useRestoredListState<T>(
  key: string,
  initial: T,
  { ready = true }: { ready?: boolean } = {},
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
    const follow = () => {
      scroll.current = window.scrollY;
    };
    window.addEventListener("scroll", follow, { passive: true });
    return () => {
      window.removeEventListener("scroll", follow);
      write(key, JSON.stringify({ state: latest.current, scrollY: scroll.current }));
    };
  }, [key]);

  // The saved position is put back once the list has its rows (`ready`): a list still loading is too short to scroll.
  // The router scrolls to the top after a page mounted (a parent's effect runs after its children's), so it is put
  // back once more on the next frame.
  const restoreTo = useRef(saved.scrollY);
  useEffect(() => {
    const y = restoreTo.current;
    if (!ready || y <= 0) return;
    restoreTo.current = 0;
    window.scrollTo(0, y);
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, y));
    return () => window.cancelAnimationFrame(frame);
  }, [ready]);

  return [state, set] as const;
}
