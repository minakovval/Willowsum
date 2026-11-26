import { useRef, useState } from "react";
import { newIdempotencyKey } from "@willowsum/api-contract";
import { useT } from "@willowsum/i18n";
import {
  CATEGORY_ICON_NAMES,
  CategoryDisc,
  Dialog,
  Field,
  FormDialog,
  SearchSelect,
  Select,
  type FormDialogField,
  type SearchGroup,
} from "@willowsum/ui";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";
import { failureOf, type ActionFailure, type Category, type Group, type Tree } from "./api.ts";

/** What «Назва» edits: a new group or category, or the name of one that exists. */
export type NameTarget =
  | { readonly kind: "newGroup" }
  | { readonly kind: "newCategory"; readonly groupId?: string }
  | { readonly kind: "renameGroup"; readonly id: string; readonly name: string }
  | { readonly kind: "renameCategory"; readonly id: string; readonly name: string };

const NAME_MAX = 60;
/** The name as the server counts it: NFC, trimmed, in code points. */
const visible = (v: string) => v.normalize("NFC").trim();

/** A failed action inside a dialog: «Така назва вже існує» and the like, or the general error with its code. */
function FailureText({ failure }: { failure: ActionFailure }) {
  const t = useT();
  if (failure.kind === "nameTaken") return <p>{t("categories.form.nameTaken")}</p>;
  if (failure.kind === "kindsDiffer") return <p>{t("categories.merge.kindsDiffer")}</p>;
  if (failure.kind === "notEmpty") return <p>{t("categories.notDeletable")}</p>;
  return (
    <>
      <p>{t("categories.error.action")}</p>
      {failure.supportId ? <p>{t("categories.code", { code: failure.supportId })}</p> : null}
    </>
  );
}

/** Runs one request at a time; `onDone` on success, otherwise the failure stays shown in the dialog. */
function useAction(onDone: (data?: unknown) => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const running = useRef(false);
  const run = async (send: () => Promise<Outcome<unknown>>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailure(null);
    const o = await send();
    running.current = false;
    setBusy(false);
    if (o.ok) onDone(o.data);
    else setFailure(failureOf(o));
  };
  return { busy, failure, run };
}

/**
 * «Нова група» (name and type, FR 2), «Нова категорія» (name and group) and «Перейменувати» of a group or a category.
 * The name is 1–60 characters and unique in the space: the server refuses a taken one with «Така назва вже існує».
 */
export function NameDialog({
  target,
  groups,
  groupKind,
  onClose,
  onDone,
}: {
  target: NameTarget | null;
  groups: Tree["groups"];
  /** «Нова категорія» of a budget screen: only the groups of this kind (an income plan takes income categories). */
  groupKind?: "expense" | "income" | undefined;
  onClose: () => void;
  /** `created` — the category a «Нова категорія» made (BUD-02@PoC FR 21, FR 22 add its row at once). */
  onDone: (created?: { readonly id: string }) => void;
}) {
  if (!target) return null;
  return (
    <NameForm
      key={target.kind === "renameGroup" || target.kind === "renameCategory" ? target.id : target.kind}
      target={target}
      groups={groups}
      groupKind={groupKind}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function NameForm({
  target,
  groups,
  groupKind,
  onClose,
  onDone,
}: {
  target: NameTarget;
  groups: Tree["groups"];
  groupKind?: "expense" | "income" | undefined;
  onClose: () => void;
  onDone: (created?: { readonly id: string }) => void;
}) {
  const t = useT();
  const api = useAuthApi();
  const renaming = target.kind === "renameGroup" || target.kind === "renameCategory";
  const [name, setName] = useState(renaming ? target.name : "");
  const [kind, setKind] = useState<"" | "expense" | "income">("");
  const [groupId, setGroupId] = useState(target.kind === "newCategory" ? (target.groupId ?? "") : "");
  // A create keeps its key while the same request is retried (ARC-07 FR 4).
  const key = useRef(newIdempotencyKey());
  const { busy, failure, run } = useAction((data) =>
    onDone(target.kind === "newCategory" ? (data as { id: string }) : undefined),
  );

  const value = visible(name);
  const nameField: FormDialogField = {
    id: "name",
    label: t("categories.form.name"),
    required: true,
    empty: value === "",
    error: [...value].length > NAME_MAX ? t("categories.form.nameLong") : null,
  };
  const fields: FormDialogField[] = [nameField];
  if (target.kind === "newGroup")
    fields.push({ id: "kind", label: t("categories.form.kind"), required: true, empty: kind === "" });
  if (target.kind === "newCategory")
    fields.push({ id: "group", label: t("categories.form.group"), required: true, empty: groupId === "" });

  const submit = () =>
    void run(() => {
      const header = { "Idempotency-Key": key.current };
      switch (target.kind) {
        case "newGroup":
          return outcome(
            api.POST("/v1/category-groups", {
              params: { header },
              body: { name: value, kind: kind as "expense" | "income" },
            }),
          );
        case "newCategory":
          return outcome(api.POST("/v1/categories", { params: { header }, body: { name: value, groupId } }));
        case "renameGroup":
          return outcome(
            api.PATCH("/v1/category-groups/{groupId}", {
              params: { path: { groupId: target.id } },
              body: { name: value },
            }),
          );
        case "renameCategory":
          return outcome(
            api.PATCH("/v1/categories/{categoryId}", {
              params: { path: { categoryId: target.id } },
              body: { name: value },
            }),
          );
      }
    });

  const title =
    target.kind === "newGroup"
      ? t("categories.newGroup")
      : target.kind === "newCategory"
        ? t("categories.newCategory")
        : t("categories.rename.title", { name: target.name });
  const submitLabel =
    target.kind === "newGroup"
      ? t("categories.newGroup.submit")
      : target.kind === "newCategory"
        ? t("categories.newCategory.submit")
        : t("categories.form.save");
  // Custom categories go into an expense or income group; «Службові» takes none (FR 1, 2).
  const groupOptions = groups
    .filter((g) => (groupKind ? g.kind === groupKind : g.kind !== "service"))
    .map((g: Group) => ({ value: g.id, label: g.name }));

  return (
    <FormDialog
      open
      onClose={onClose}
      title={title}
      closeLabel={t("shell.close")}
      fields={fields}
      submitLabel={submitLabel}
      busyLabel={renaming ? t("categories.form.saving") : t("categories.form.adding")}
      busy={busy}
      editing={renaming}
      error={failure ? <FailureText failure={failure} /> : undefined}
      onSubmit={submit}
    >
      {(form) => (
        <>
          <Field
            label={t("categories.form.name")}
            required
            value={name}
            onChange={setName}
            onBlur={form.leave("name")}
            error={form.errorOf("name")}
            autoComplete="off"
          />
          {target.kind === "newGroup" ? (
            <Select
              label={t("categories.form.kind")}
              required
              value={kind}
              onChange={(v) => setKind(v as "" | "expense" | "income")}
              options={[
                { value: "expense", label: t("categories.form.kind.expense") },
                { value: "income", label: t("categories.form.kind.income") },
              ]}
              error={form.errorOf("kind")}
            />
          ) : null}
          {target.kind === "newCategory" ? (
            <Select
              label={t("categories.form.group")}
              required
              value={groupId}
              onChange={setGroupId}
              options={groupOptions}
              error={form.errorOf("group")}
            />
          ) : null}
        </>
      )}
    </FormDialog>
  );
}

/**
 * «Іконка і колір» (FR 10): the icons of the category set and the colours the space's tree already uses, each named
 * by a category that has it, so the choice stays within the palette of BUD-01 and needs no colour of its own here.
 */
export function AppearanceDialog({
  category,
  tree,
  onClose,
  onDone,
}: {
  category: Category | null;
  tree: Tree;
  onClose: () => void;
  onDone: () => void;
}) {
  if (!category) return null;
  return (
    <AppearanceForm key={category.id} category={category} tree={tree} onClose={onClose} onDone={onDone} />
  );
}

function AppearanceForm({
  category,
  tree,
  onClose,
  onDone,
}: {
  category: Category;
  tree: Tree;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const api = useAuthApi();
  const [icon, setIcon] = useState(category.icon);
  const [color, setColor] = useState(category.color.toUpperCase());
  const { busy, failure, run } = useAction(onDone);
  const all = tree.groups.flatMap((g) => g.categories);
  const owner = (pick: (c: Category) => boolean) => all.find(pick)?.name;

  // Each colour once, in the order of the tree; the icon tone of a colour is the one the server gave a category with it.
  const colours = new Map<string, { tone: "white" | "ink"; name: string }>();
  for (const c of all) {
    const hex = c.color.toUpperCase();
    if (!colours.has(hex)) colours.set(hex, { tone: c.iconTone, name: c.name });
  }
  const tone = colours.get(color)?.tone ?? category.iconTone;
  // The icons the tree uses and «shapes» of a new custom category; the category's own comes first if it is another.
  const icons: string[] = CATEGORY_ICON_NAMES.filter(
    (n) => n === "shapes" || owner((c) => c.icon === n) !== undefined,
  );
  if (!icons.includes(category.icon)) icons.unshift(category.icon);

  const changed = icon !== category.icon || color !== category.color.toUpperCase();
  const save = () =>
    void run(() =>
      outcome(
        api.PATCH("/v1/categories/{categoryId}", {
          params: { path: { categoryId: category.id } },
          body: {
            ...(icon !== category.icon ? { icon } : {}),
            ...(color !== category.color.toUpperCase() ? { color } : {}),
          },
        }),
      ),
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("categories.appearance.title", { name: category.name })}
      icon="art"
      align="start"
      size="wide"
      closeLabel={t("shell.close")}
      busy={busy}
      error={failure ? <FailureText failure={failure} /> : undefined}
      bar="form"
      actions={[
        { label: t("categories.form.cancel"), onClick: onClose },
        {
          label: t("categories.form.save"),
          variant: "primary",
          busyLabel: t("categories.form.saving"),
          onClick: changed ? save : onClose,
        },
      ]}
    >
      <fieldset className="cat-choice">
        <legend>{t("categories.appearance.icon")}</legend>
        <div className="cat-choice-grid">
          {icons.map((n) => {
            const of = n === "shapes" ? undefined : owner((c) => c.icon === n);
            const label = of
              ? t("categories.appearance.as", { name: of })
              : t("categories.appearance.general");
            return (
              <label key={n} className="cat-choice-option" title={label}>
                <input
                  type="radio"
                  name="cat-icon"
                  value={n}
                  checked={icon === n}
                  onChange={() => setIcon(n)}
                  aria-label={label}
                />
                <CategoryDisc color={color} icon={n} iconTone={tone} size={32} />
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="cat-choice">
        <legend>{t("categories.appearance.color")}</legend>
        <div className="cat-choice-grid">
          {[...colours].map(([hex, c]) => {
            const label = t("categories.appearance.as", { name: c.name });
            return (
              <label key={hex} className="cat-choice-option" title={label}>
                <input
                  type="radio"
                  name="cat-color"
                  value={hex}
                  checked={color === hex}
                  onChange={() => setColor(hex)}
                  aria-label={label}
                />
                <CategoryDisc color={hex} icon={icon} iconTone={c.tone} size={32} />
              </label>
            );
          })}
        </div>
      </fieldset>
    </Dialog>
  );
}

/**
 * «Об’єднати з іншою…» (FR 8, AC5, AC6): any category in use but the source, the service ones and the hidden ones;
 * one of the other type is refused here with «Категорії різних типів не можна об'єднати», as the server would. The
 * server moves transactions, split parts, rules, recurring payments and the limit, and writes the audit entry.
 */
export function MergeDialog({
  category,
  tree,
  onClose,
  onDone,
}: {
  category: Category | null;
  tree: Tree;
  onClose: () => void;
  onDone: () => void;
}) {
  if (!category) return null;
  return <MergeForm key={category.id} category={category} tree={tree} onClose={onClose} onDone={onDone} />;
}

function MergeForm({
  category,
  tree,
  onClose,
  onDone,
}: {
  category: Category;
  tree: Tree;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const api = useAuthApi();
  const [targetId, setTargetId] = useState("");
  const { busy, failure, run } = useAction(onDone);
  const groups: SearchGroup[] = tree.groups
    .filter((g) => g.kind !== "service")
    .map((g) => ({
      id: g.id,
      title: g.name,
      options: g.categories
        .filter((c) => c.id !== category.id && !c.hidden)
        .map((c) => ({
          value: c.id,
          label: c.name,
          leading: <CategoryDisc color={c.color} icon={c.icon} iconTone={c.iconTone} />,
        })),
    }))
    .filter((g) => g.options.length > 0);
  const target = tree.groups.flatMap((g) => g.categories).find((c) => c.id === targetId);
  const differ = target !== undefined && target.kind !== category.kind;
  const note = target === undefined ? t("categories.merge.pick") : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("categories.merge.title", { name: category.name })}
      text={t("categories.merge.text")}
      icon="plans"
      tone="warning"
      align="start"
      closeLabel={t("shell.close")}
      busy={busy}
      note={note}
      error={failure ? <FailureText failure={failure} /> : undefined}
      actions={[
        { label: t("categories.form.cancel"), onClick: onClose },
        {
          label: t("categories.merge.submit"),
          variant: "primary",
          busyLabel: t("categories.merge.busy"),
          disabled: target === undefined || differ,
          onClick: () =>
            void run(() =>
              outcome(
                api.POST("/v1/categories/{categoryId}/merge", {
                  params: { path: { categoryId: category.id } },
                  body: { targetId },
                }),
              ),
            ),
        },
      ]}
    >
      <SearchSelect
        label={t("categories.merge.target")}
        required
        groups={groups}
        value={targetId}
        onChange={setTargetId}
        searchLabel={t("categories.search")}
        showLeading
        error={differ ? t("categories.merge.kindsDiffer") : undefined}
      />
    </Dialog>
  );
}
