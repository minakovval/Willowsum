import { useState } from "react";
import { useT } from "@willowsum/i18n";
import { Notice } from "../auth/AuthLayout.tsx";
import { currentBrowserSupport, type BrowserSupport } from "./support.ts";

/**
 * NFR-07@PoC EC1: in an unsupported browser, a polite warning that names the supported browsers. It never blocks:
 * the form below it works as usual (the warning marker and the word carry the meaning, DS-06 AC9).
 */
export function UnsupportedBrowserNotice({ support }: { readonly support?: BrowserSupport }) {
  const t = useT();
  const [detected] = useState(currentBrowserSupport);
  if ((support ?? detected) === "supported") return null;
  return (
    <div className="unsupported-browser">
      <Notice tone="warning" title={t("browser.unsupported.title")}>
        {t("browser.unsupported.body")}
      </Notice>
    </div>
  );
}
