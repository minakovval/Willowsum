import { useState, type ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { Dialog, Icon, MenuButton, type MenuItem } from "@willowsum/ui";
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
export function categoryMenu(
  t: ReturnType<typeof useT>,
  act: {
    readonly rename: () => void;
    readonly removeFromBudget: (() => void) | null;
    readonly remove: () => void;
  },
): MenuItem[] {
  const items: MenuItem[] = [
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

/** The «…» («Ще дії») at the end of a category row. */
export function RowMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const t = useT();
  return (
    <MenuButton
      menuLabel={t("categories.menu.category", { name })}
      ariaLabel={t("categories.more")}
      title={t("categories.more")}
      placement="down"
      align="end"
      className="ws-icon-button"
      items={items}
    >
      <Icon name="more" size={20} inButton />
    </MenuButton>
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
