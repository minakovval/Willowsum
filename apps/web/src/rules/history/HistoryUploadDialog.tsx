import { useEffect, useRef, useState, type DragEvent } from "react";
import { useT, type MessageKey } from "@willowsum/i18n";
import { Button, Dialog, Icon, Progress } from "@willowsum/ui";
import { useAuthApi } from "../../auth/api.ts";
import { historyReviewPath } from "../../routing/routes.ts";
import { MAX_HISTORY_BYTES, rejectionCode, uploadHistoryFile } from "./api.ts";
import "./history.css";

/**
 * S-298 «Завантажити файл історії» (BUD-21@PoC FR 2, FR 3, AC5; canvas PocMoneyHistoryUpload and its «Тексти»): the file
 * goes to the server as a statement's does (the same safety checks); the answer is the batch of the file, which the
 * step «Перевірка розпізнавання» opens. The same file still stored opens its batch (`existing`). The user does not
 * say what kind of file it is.
 */
const ACCEPT = ".csv,.tsv,.xlsx,.xls,text/csv,text/tab-separated-values";
const OPEN_DELAY_MS = 1200;
/** The codes that mean «too large» (FR 3 ceilings); a book with macros is `UNSUPPORTED_FORMAT` (IMP-01 FR 13). */
const LARGE = new Set([
  "FILE_TOO_LARGE",
  "REQUEST_TOO_LARGE",
  "TOO_MANY_ROWS",
  "TOO_MANY_CELLS",
  "ARCHIVE_LIMIT",
]);

type State =
  | { readonly kind: "pick" }
  | { readonly kind: "reading"; readonly name: string }
  | { readonly kind: "existing"; readonly name: string }
  | { readonly kind: "error"; readonly text: MessageKey };

export function HistoryUploadDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const api = useAuthApi();
  const picker = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<State>({ kind: "pick" });
  const [dragging, setDragging] = useState(false);

  useEffect(
    () => () => {
      alive.current = false;
      clearTimeout(timer.current);
    },
    [],
  );

  const send = async (file: File) => {
    if (file.size > MAX_HISTORY_BYTES) {
      setState({ kind: "error", text: "history.upload.error.large" });
      return;
    }
    setState({ kind: "reading", name: file.name });
    const o = await uploadHistoryFile(api, file);
    if (!alive.current) return;
    if (!o.ok) {
      const code = rejectionCode(o);
      setState({
        kind: "error",
        text:
          code === "UNSUPPORTED_FORMAT"
            ? "history.upload.error.macros"
            : code && LARGE.has(code)
              ? "history.upload.error.large"
              : "history.upload.error.read",
      });
      return;
    }
    const open = () => {
      window.location.hash = historyReviewPath(o.data.batch.id);
    };
    if (o.data.existing) {
      setState({ kind: "existing", name: o.data.batch.fileName });
      timer.current = setTimeout(open, OPEN_DELAY_MS);
    } else open();
  };

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void send(file);
    if (picker.current) picker.current.value = "";
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files);
  };

  const failed = state.kind === "error";
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("history.upload.title")}
      closeLabel={t("shell.close")}
      align="start"
      actions={
        failed
          ? [
              { label: t("history.upload.close"), onClick: onClose, variant: "secondary" },
              {
                label: t("history.upload.another"),
                onClick: () => picker.current?.click(),
                variant: "primary",
              },
            ]
          : [
              {
                label: t("history.upload.cancel"),
                onClick: onClose,
                variant: "secondary",
              },
            ]
      }
      error={state.kind === "error" ? <span role="alert">{t(state.text)}</span> : undefined}
      text={state.kind === "pick" ? t("history.upload.text") : undefined}
    >
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        className="ws-visually-hidden"
        tabIndex={-1}
        aria-label={t("history.upload.chooseLabel")}
        onChange={(e) => take(e.target.files)}
      />
      {state.kind === "pick" ? (
        <div
          className="hist-drop"
          data-dragging={dragging || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="hist-drop-icon" aria-hidden="true">
            <Icon name="upload" size={24} />
          </span>
          <p className="hist-drop-title">{t("history.upload.drop")}</p>
          <p className="hist-drop-formats ws-muted">{t("history.upload.formats")}</p>
          <Button label={t("history.upload.choose")} onClick={() => picker.current?.click()} />
        </div>
      ) : null}
      {state.kind === "reading" || state.kind === "existing" ? (
        <div className="hist-reading" aria-live="polite">
          <p className="hist-reading-title">{t("history.upload.progress", { name: state.name })}</p>
          {state.kind === "existing" ? (
            <p role="status">{t("history.upload.existing")}</p>
          ) : (
            <>
              <Progress label={t("history.upload.progress", { name: state.name })} />
              <p className="ws-muted">{t("history.upload.step")}</p>
            </>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
