/**
 * A matchMedia stand-in for jsdom that evaluates `min-width`, `max-width`, `prefers-color-scheme`
 * and `prefers-reduced-motion` against a simulated viewport. `setViewport` notifies listeners.
 */
interface Viewport {
  width: number;
  dark: boolean;
  reducedMotion: boolean;
}

const listeners = new Set<{ query: string; cb: (e: MediaQueryListEvent) => void }>();
let viewport: Viewport = { width: 1280, dark: false, reducedMotion: false };

function evaluate(query: string): boolean {
  return query.split(/\s+and\s+/).every((part) => {
    const min = /min-width:\s*([\d.]+)px/.exec(part);
    if (min) return viewport.width >= Number(min[1]);
    const max = /max-width:\s*([\d.]+)px/.exec(part);
    if (max) return viewport.width <= Number(max[1]);
    const scheme = /prefers-color-scheme:\s*(dark|light)/.exec(part);
    if (scheme) return (scheme[1] === "dark") === viewport.dark;
    if (/prefers-reduced-motion:\s*reduce/.test(part)) return viewport.reducedMotion;
    return false;
  });
}

export function installMatchMedia(initial: Partial<Viewport> = {}): void {
  viewport = { width: 1280, dark: false, reducedMotion: false, ...initial };
  listeners.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: viewport.width });
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      get matches() {
        return evaluate(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => listeners.add({ query, cb }),
      removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
        for (const l of listeners) if (l.cb === cb && l.query === query) listeners.delete(l);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;
}

export function setViewport(next: Partial<Viewport>): void {
  viewport = { ...viewport, ...next };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: viewport.width });
  for (const l of [...listeners]) l.cb({ matches: evaluate(l.query), media: l.query } as MediaQueryListEvent);
}
