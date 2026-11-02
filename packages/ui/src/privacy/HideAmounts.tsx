import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { keepNumbersTogether, useT } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";
import { motion } from "../tokens/motion.ts";
import type { TypeStyleName } from "../tokens/typography.ts";
import { readStorage, writeStorage } from "../storage.ts";

/** DS-18 item 3: what replaces every amount. */
export const HIDDEN_AMOUNT = "•••";

/**
 * Stored on this device for the prototype. DS-18 item 1 makes it a personal setting synced across
 * devices within 5 s; that sync arrives with the user profile API.
 */
export const HIDE_AMOUNTS_STORAGE_KEY = "ws-hide-amounts";

interface HideAmountsValue {
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  toggle: () => void;
}

const HideAmountsContext = createContext<HideAmountsValue | null>(null);

export function HideAmountsProvider({
  initialHidden,
  children,
}: {
  initialHidden?: boolean;
  children: ReactNode;
}) {
  const [hidden, setHiddenState] = useState<boolean>(
    () => initialHidden ?? readStorage(HIDE_AMOUNTS_STORAGE_KEY) === "1",
  );
  const setHidden = useCallback((next: boolean) => {
    setHiddenState(next);
    writeStorage(HIDE_AMOUNTS_STORAGE_KEY, next ? "1" : null);
  }, []);
  const toggle = useCallback(() => setHidden(!hidden), [hidden, setHidden]);
  const value = useMemo(() => ({ hidden, setHidden, toggle }), [hidden, setHidden, toggle]);
  return <HideAmountsContext.Provider value={value}>{children}</HideAmountsContext.Provider>;
}

export function useHideAmounts(): HideAmountsValue {
  const value = useContext(HideAmountsContext);
  if (!value) throw new Error("useHideAmounts must be used inside <HideAmountsProvider>");
  return value;
}

type AmountStyle = Extract<TypeStyleName, "amount-xl" | "amount-l" | "amount-m"> | "inherit";

/**
 * The one place where an amount reaches the screen (DS-18 item 3). `value` is already formatted
 * (formatting per DS-04 lives with Money in packages/domain-kernel). While amounts are hidden the
 * real value is not in the DOM (DS-18 item 7); holding 350 ms or Enter / Space shows it for 3 s.
 */
export function Amount({ value, size = "inherit" }: { value: string; size?: AmountStyle }) {
  const t = useT();
  const { hidden } = useHideAmounts();
  const [revealed, setRevealed] = useState(false);
  // Turning hiding off and on again must not keep an earlier reveal (it would show the value without a
  // hold). Adjusting state during render when an input changes is React's recommended pattern.
  const [prevHidden, setPrevHidden] = useState(hidden);
  if (prevHidden !== hidden) {
    setPrevHidden(hidden);
    setRevealed(false);
  }
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reveal = useCallback(() => {
    setRevealed(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRevealed(false), motion["duration-reveal-visible"]);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(holdTimer.current);
      clearTimeout(hideTimer.current);
    },
    [],
  );

  const cls = ["ws-amount", size !== "inherit" && `ws-text-${size}`].filter(Boolean).join(" ");

  if (!hidden) return <span className={cls}>{keepNumbersTogether(value)}</span>;

  const startHold = () => {
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(reveal, motion["duration-reveal-hold"]);
  };
  const cancelHold = () => clearTimeout(holdTimer.current);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      reveal();
    }
  };

  return (
    <button
      type="button"
      className={`${cls} ws-amount-hidden`}
      aria-label={revealed ? undefined : t("amount.hidden")}
      aria-live="polite"
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {revealed ? keepNumbersTogether(value) : <span aria-hidden="true">{HIDDEN_AMOUNT}</span>}
    </button>
  );
}

/** Percentages, shares and direction stay visible in hidden mode (DS-18 item 4). */
export function Percent({ value }: { value: string }) {
  return <span className="ws-percent ws-tabular">{keepNumbersTogether(value)}</span>;
}

/** DS-18 item 1 / CMP-69: the eye icon button among the global actions, with a pressed state. */
export function HideAmountsToggle() {
  const t = useT();
  const { hidden, toggle } = useHideAmounts();
  const label = t("privacy.hideAmounts");
  return (
    <button type="button" className="ws-icon-button" aria-pressed={hidden} title={label} onClick={toggle}>
      <Icon name={hidden ? "eye-off" : "eye"} size={24} />
      <span className="ws-visually-hidden">{label}</span>
    </button>
  );
}

/** The same setting as a labelled switch (settings, gallery). */
export function HideAmountsSwitch() {
  const t = useT();
  const { hidden, setHidden } = useHideAmounts();
  return (
    <label className="ws-switch">
      <input type="checkbox" role="switch" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
      <span className="ws-switch-track" aria-hidden="true" />
      <span>{t("privacy.hideAmounts")}</span>
    </label>
  );
}
