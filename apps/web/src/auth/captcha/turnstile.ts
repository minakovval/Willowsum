import { CAPTCHA_ORIGIN } from "../../../security-headers.ts";

/**
 * The thin browser adapter of Cloudflare Turnstile (ARC-05: the provider only behind an adapter; ADR-0009). It loads
 * the provider's script from the one third-party origin the CSP allows (`script-src`, `frame-src`; NFR-14) — never an
 * inline script — and renders the widget explicitly into a given element. Nothing personal is passed to it.
 */
export const TURNSTILE_SCRIPT = `${CAPTCHA_ORIGIN}/turnstile/v0/api.js?render=explicit`;

export interface TurnstileRenderOptions {
  readonly sitekey: string;
  readonly action?: string;
  readonly language?: string;
  readonly theme?: "light" | "dark" | "auto";
  readonly callback: (token: string) => void;
  readonly "expired-callback": () => void;
  readonly "error-callback": () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** The provider's API, loading its script once per page. */
export function loadTurnstile(doc: Document = document): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile: no API after load")),
    );
    script.addEventListener("error", () => reject(new Error("turnstile: the script did not load")));
    doc.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Tests only: forget a loaded or failed script. */
export function resetTurnstileLoader(): void {
  loading = null;
}
