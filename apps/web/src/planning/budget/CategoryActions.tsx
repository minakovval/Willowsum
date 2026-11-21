import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useT } from "@willowsum/i18n";
import { Button, Dialog, Icon, MenuButton, Popover, type MenuItem } from "@willowsum/ui";
import { outcome, useAuthApi } from "../../auth/api.ts";
import { failureOf, type ActionFailure, type Category, type Tree } from "../../categories/api.ts";
import { DeleteDialog, MergeDialog, NameDialog, type NameTarget } from "../../categories/dialogs.tsx";

/**
 * BUD-02@PoC FR 7, FR 22, FR 23 (owner, 2026-11-21, «3 а»): the actions of a category on the budget screens — the wizard
 * step «Ліміти» and the page «Бюджет» — in one place: «Перейменувати», «Прибрати з бюджету», «Видалити категорію…», and
 * «Додати категорію» with «Нова категорія…». The dialogs are the ones of «Налаштування → Категорії» (BUD-01 FR 8, 12):
 * rename (a taken name — «Така назва вже існує»), delete of an empty custom category after the confirmation, merge. A
 * category that cannot be deleted gets the choice «Приховати» or «Об'єднати з іншою…» (BUD-01 FR 13). The count of its
 * transactions is not shown: the server does not give it yet (follow-up in the PR body). «Прибрати з бюджету» is the
 * screen's own (the wizard clears the limit, the page sends it to the server), so it comes in as `onRemove`.
 */
type Open =
  | { readonly kind: "none" }
  | { readonly kind: "name"; readonly target: NameTarget; readonly groupKind?: "expense" | "income" }
  | { readonly kind: "delete"; readonly category: Category }
  | { readonly kind: "keep"; readonly category: Category }
  | { readonly kind: "merge"; readonly category: Category };

export interface CategoryActions {
  readonly rename: (category: Category) => void;
  readonly remove: (category: Category) => void;
  /** «Нова категорія…» of a group of expenses. */
  readonly addTo: (groupId: string) => void;
  /** «Нова категорія доходу…». */
  readonly addIncome: () => void;
  readonly dialogs: ReactNode;
}

export function useCategoryActions({
  tree,
  onChanged,
  onCreated,
}: {
  tree: Tree;
  /** A rename, a delete, a merge or a hide went through: read the categories again. */
  onChanged: () => void;
  /** A new category exists (its row is added by the screen). */
  onCreated: (id: string) => void;
}): CategoryActions {
  const [open, setOpen] = useState<Open>({ kind: "none" });
  const close = () => setOpen({ kind: "none" });
  const done = () => {
    close();
    onChanged();
  };
  return {
    rename: (c) => setOpen({ kind: "name", target: { kind: "renameCategory", id: c.id, name: c.name } }),
    remove: (c) => setOpen(c.deletable ? { kind: "delete", category: c } : { kind: "keep", category: c }),
    addTo: (groupId) =>
      setOpen({ kind: "name", target: { kind: "newCategory", groupId }, groupKind: "expense" }),
    addIncome: () => setOpen({ kind: "name", target: { kind: "newCategory" }, groupKind: "income" }),
    dialogs: (
      <>
        <NameDialog
          target={open.kind === "name" ? open.target : null}
          groups={tree.groups}
          groupKind={open.kind === "name" ? open.groupKind : undefined}
          onClose={close}
          onDone={(created) => {
            close();
            if (created) onCreated(created.id);
            else onChanged();
          }}
        />
        <DeleteDialog
          category={open.kind === "delete" ? open.category : null}
          onClose={close}
          onDone={done}
        />
        <KeepDialog
          category={open.kind === "keep" ? open.category : null}
          onClose={close}
          onHidden={done}
          onMerge={(c) => setOpen({ kind: "merge", category: c })}
        />
        <MergeDialog
          category={open.kind === "merge" ? open.category : null}
          tree={tree}
          onClose={close}
          onDone={done}
        />
      </>
    ),
  };
}

/**
 * «Видалити категорію…» of a category that cannot be deleted (it has transactions, rules or limits, or it is a system
 * one): the reason and the two ways out of BUD-01 FR 13 — hide it or merge it into another.
 */
function KeepDialog({
  category,
  onClose,
  onHidden,
  onMerge,
}: {
  category: Category | null;
  onClose: () => void;
  onHidden: () => void;
  onMerge: (category: Category) => void;
}) {
  const t = useT();
  const api = useAuthApi();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  if (!category) return null;
  const hide = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const o = await outcome(
      api.PATCH("/v1/categories/{categoryId}", {
        params: { path: { categoryId: category.id } },
        body: { hidden: true },
      }),
    );
    setBusy(false);
    if (o.ok) onHidden();
    else setFailure(failureOf(o));
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("categories.delete.title", { name: category.name })}
      text={t("planning.budget.cat.delete.keep")}
      icon="trash"
      tone="warning"
      align="start"
      closeLabel={t("shell.close")}
      busy={busy}
      error={failure ? <p>{t("categories.error.action")}</p> : undefined}
      actions={[
        { label: t("categories.form.cancel"), onClick: onClose },
        { label: t("categories.action.hide"), onClick: () => void hide() },
        {
          label: t("categories.action.merge"),
          variant: "primary",
          onClick: () => onMerge(category),
        },
      ]}
    />
  );
}

/** The items of the «…» of a category row; «Прибрати з бюджету» only when the row has something to remove. */
function categoryMenu(
  t: ReturnType<typeof useT>,
  act: {
    readonly mandatory: () => void;
    readonly rename: () => void;
    readonly removeFromBudget: (() => void) | null;
    readonly remove: () => void;
  },
): MenuItem[] {
  const items: MenuItem[] = [
    { id: "mandatory", label: t("categories.action.essential"), icon: "check", onSelect: act.mandatory },
    { id: "rename", label: t("planning.budget.cat.rename"), icon: "edit", onSelect: act.rename },
  ];
  if (act.removeFromBudget)
    items.push({
      id: "unbudget",
      label: t("planning.budget.cat.unbudget"),
      icon: "close",
      onSelect: act.removeFromBudget,
    });
  items.push({
    id: "delete",
    label: t("planning.budget.cat.delete"),
    icon: "trash",
    danger: true,
    onSelect: act.remove,
  });
  return items;
}

/**
 * The «…» («Ще дії: {name}») at the end of a category row (BUD-02@PoC FR 7, FR 22): «Обов'язкова · Перейменувати ·
 * Прибрати з бюджету · Видалити категорію…». «Обов'язкова» opens a small popover from the row (no modal dialog): the
 * attribute belongs to the category of the space (BUD-01), so it is saved on the category.
 */
export function RowMenu({
  category,
  actions,
  removeFromBudget,
  onChanged,
}: {
  category: Category;
  actions: CategoryActions;
  removeFromBudget: (() => void) | null;
  onChanged: () => void;
}) {
  const t = useT();
  const host = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span className="ws-popover-host" ref={host}>
      <MenuButton
        menuLabel={t("categories.menu.category", { name: category.name })}
        ariaLabel={t("planning.budget.cat.more", { name: category.name })}
        title={t("categories.more")}
        placement="down"
        align="end"
        className="ws-icon-button"
        items={categoryMenu(t, {
          mandatory: () => setOpen(true),
          rename: () => actions.rename(category),
          removeFromBudget,
          remove: () => actions.remove(category),
        })}
      >
        <Icon name="more" size={20} inButton />
      </MenuButton>
      <MandatoryPopover
        category={open ? category : null}
        anchor={host}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          onChanged();
        }}
      />
    </span>
  );
}

/** «Обов'язкова» of a category (BUD-02@PoC FR 7): one checkbox, saved on the category with «Зберегти». */
function MandatoryPopover({
  category,
  anchor,
  onClose,
  onSaved,
}: {
  category: Category | null;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const api = useAuthApi();
  const [value, setValue] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = value ?? category?.essential === true;
  const close = () => {
    setValue(null);
    setFailed(false);
    onClose();
  };
  const save = async () => {
    if (!category || busy) return;
    setBusy(true);
    setFailed(false);
    const o = await outcome(
      api.PATCH("/v1/categories/{categoryId}", {
        params: { path: { categoryId: category.id } },
        body: { essential: current },
      }),
    );
    setBusy(false);
    if (o.ok) {
      setValue(null);
      onSaved();
    } else setFailed(true);
  };
  return (
    <Popover
      open={category !== null}
      onClose={close}
      label={t("planning.budget.cat.mandatory.title", { name: category?.name ?? "" })}
      anchor={anchor}
    >
      <form
        className="bud-mandatory"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="bud-mandatory-field">
          <input type="checkbox" checked={current} onChange={(e) => setValue(e.target.checked)} />
          <span>{t("categories.action.essential")}</span>
        </label>
        {failed ? <p role="alert">{t("categories.error.action")}</p> : null}
        <div className="bud-mandatory-actions">
          <Button label={t("categories.form.cancel")} onClick={close} />
          <Button label={t("categories.form.save")} variant="primary" type="submit" loading={busy} />
        </div>
      </form>
    </Popover>
  );
}

/** «Додати категорію» in the heading of a group: its menu has «Нова категорія…». */
export function AddCategoryMenu({ group, onNew }: { group: string; onNew: () => void }) {
  const t = useT();
  return (
    <MenuButton
      menuLabel={t("planning.budget.cat.add.menu", { group })}
      placement="down"
      align="end"
      className="ws-button ws-button-with-icon"
      items={[{ id: "new", label: t("planning.budget.cat.new"), icon: "tag", onSelect: onNew }]}
    >
      <span className="ws-button-slot" aria-hidden="true">
        <Icon name="plus" size={16} inButton />
      </span>
      <span className="ws-button-label">{t("planning.budget.cat.add")}</span>
    </MenuButton>
  );
}
