import { useState } from "react";
import { useT } from "@willowsum/i18n";
import { Toast, type ToastTone } from "@willowsum/ui";

/**
 * The Toast of the review queue (BUD-12@PoC FR 6) in the design-system gallery: each tone on a synthetic message,
 * one at a time (a new one replaces the shown one), with and without «Відмінити».
 */
const CASES: readonly { id: string; tone: ToastTone; undo: boolean }[] = [
  { id: "undo", tone: "success", undo: true },
  { id: "info", tone: "info", undo: false },
  { id: "error", tone: "error", undo: false },
];

export function ToastDemo() {
  const t = useT();
  const [shown, setShown] = useState<{ key: number; id: string } | null>(null);
  const current = CASES.find((c) => c.id === shown?.id);
  return (
    <div className="gallery-toast">
      <p className="ws-muted">{t("gallery.toast.intro")}</p>
      <div className="app-page-actions">
        {CASES.map((c) => (
          <button
            key={c.id}
            type="button"
            className="ws-button"
            data-toast={c.id}
            onClick={() => setShown((s) => ({ key: (s?.key ?? 0) + 1, id: c.id }))}
          >
            {t(`gallery.toast.show.${c.id}` as "gallery.toast.show.undo")}
          </button>
        ))}
      </div>
      {shown && current ? (
        <Toast
          key={shown.key}
          tone={current.tone}
          text={t(`gallery.toast.text.${current.id}` as "gallery.toast.text.undo")}
          closeLabel={t("shell.close")}
          onDismiss={() => setShown(null)}
          action={current.undo ? { label: t("review.undo"), onAction: () => setShown(null) } : undefined}
        />
      ) : null}
    </div>
  );
}
