import { createContext, useContext } from "react";

/**
 * Where floating parts (a tooltip) are rendered. A modal dialog sits in the browser's top layer and makes the rest
 * of the page inert, so a tooltip of a control inside it is rendered inside the dialog; elsewhere it goes to
 * `document.body`.
 */
export const PortalRootContext = createContext<HTMLElement | null>(null);

export const usePortalRoot = (): HTMLElement | null =>
  useContext(PortalRootContext) ?? (typeof document === "undefined" ? null : document.body);
