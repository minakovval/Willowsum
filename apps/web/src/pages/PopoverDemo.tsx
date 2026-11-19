import { useRef, useState } from "react";
import { useT } from "@willowsum/i18n";
import { Button, Popover } from "@willowsum/ui";

/** CMP-61@PoC FR 8 in the design-system gallery: the popover of a button — a dialog with no backdrop. */
export function PopoverDemo() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <div className="gallery-popover">
      <p className="ws-muted">{t("gallery.popover.intro")}</p>
      <span className="ws-popover-host" ref={anchor}>
        <Button label={t("gallery.popover.open")} onClick={() => setOpen((o) => !o)} />
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          label={t("gallery.popover.name")}
          anchor={anchor}
          align="start"
        >
          <label>
            {t("gallery.popover.field")} <input type="text" inputMode="decimal" />
          </label>
          <p>
            <Button label={t("gallery.popover.cancel")} onClick={() => setOpen(false)} />{" "}
            <Button label={t("gallery.popover.submit")} variant="primary" onClick={() => setOpen(false)} />
          </p>
        </Popover>
      </span>
    </div>
  );
}
