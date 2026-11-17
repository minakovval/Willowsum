import { useState } from "react";
import { useT } from "@willowsum/i18n";
import { Badge, Button, CategoryDisc, Field, Icon, MenuButton, Skeleton, type MenuItem } from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import { AppLayout } from "../pages/AppLayout.tsx";
import { EmptyState } from "../pages/SectionPage.tsx";
import { SETTINGS_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import {
  failureOf,
  useCategoryTree,
  type ActionFailure,
  type Category,
  type Group,
  type Tree,
} from "./api.ts";
import { AppearanceDialog, DeleteDialog, MergeDialog, NameDialog, type NameTarget } from "./dialogs.tsx";
import "./categories.css";

/**
 * S-196 «Налаштування → Категорії» (BUD-01@PoC c), canvas PocSettingsCategories and its «Тексти» board): the space's
 * tree «група → категорія» from `GET /v1/categories`, a search, «Показати приховані · N», «Нова група» and «Нова
 * категорія», and the «…» menu of each group and category — rename, icon and colour, «обов'язкова» for expenses,
 * merge, hide or show, and delete for an empty custom category (FR 2, 3, 8, 10, 11, 12). The order of the tree is the
 * server's; the drag handles of the board are not in the PoC view (PR body).
 */
export function CategoriesPage() {
  const t = useT();
  const title = t("categories.title");
  useDocumentTitle(title);
  const { state, reload } = useCategoryTree();
  return (
    <AppLayout sectionId={null} pageId={null}>
      <div className="cat-page">
        <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
          <ol>
            <li>
              <a href={hrefFor(SETTINGS_PATH)}>{t("shell.settings")}</a>
            </li>
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
        <div className="cat-head">
          <h1>{title}</h1>
          <p className="ws-muted">{t("categories.subtitle")}</p>
        </div>
        {state.kind === "loading" ? (
          // BUD-01@PoC «Стани»: the skeleton of the tree.
          <div className="ws-card cat-tree" aria-busy="true">
            <Skeleton variant="row" lines={8} />
          </div>
        ) : state.kind === "off" ? (
          <EmptyState icon="settings" />
        ) : state.kind === "error" ? (
          <section className="ws-card cat-error" role="alert">
            <p>{t("categories.load.error")}</p>
            <Button label={t("categories.retry")} onClick={reload} />
            {state.supportId ? (
              <p className="ws-muted">{t("categories.code", { code: state.supportId })}</p>
            ) : null}
          </section>
        ) : (
          <CategoryTree tree={state.tree} reload={reload} />
        )}
      </div>
    </AppLayout>
  );
}

type Open =
  | { readonly kind: "none" }
  | { readonly kind: "name"; readonly target: NameTarget }
  | { readonly kind: "appearance"; readonly category: Category }
  | { readonly kind: "merge"; readonly category: Category }
  | { readonly kind: "delete"; readonly category: Category };

/** NFC, lower case: «кава» finds «Кава з собою». */
const fold = (s: string) => s.normalize("NFC").toLocaleLowerCase("uk").trim();

function CategoryTree({ tree, reload }: { tree: Tree; reload: () => void }) {
  const t = useT();
  const api = useAuthApi();
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<Open>({ kind: "none" });
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const all = tree.groups.flatMap((g) => g.categories);
  const hiddenCount = all.filter((c) => c.hidden).length;
  const hasCustom = all.some((c) => c.systemKey === null);
  const q = fold(query);
  const close = () => setOpen({ kind: "none" });

  /** Hide, show and «обов'язкова» change at once from the menu; a failure leaves the data as it was. */
  const patch = async (category: Category, body: { hidden?: boolean; essential?: boolean }) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const o = await outcome(
      api.PATCH("/v1/categories/{categoryId}", { params: { path: { categoryId: category.id } }, body }),
    );
    setBusy(false);
    if (o.ok) reload();
    else setFailure(failureOf(o));
  };

  const groups = tree.groups
    .map((g) => {
      const shown = g.categories.filter((c) => showHidden || !c.hidden);
      const groupMatches = q !== "" && fold(g.name).includes(q);
      const found = q === "" || groupMatches ? shown : shown.filter((c) => fold(c.name).includes(q));
      return { group: g, shown, found, visible: q === "" || groupMatches || found.length > 0 };
    })
    .filter((g) => g.visible);

  return (
    <>
      <div className="cat-toolbar">
        <Field
          label={t("categories.search")}
          labelHidden
          size="search"
          type="search"
          placeholder={t("categories.search")}
          prefix={<Icon name="search" size={16} />}
          value={query}
          onChange={setQuery}
          className="cat-search"
        />
        <label className="cat-hidden-toggle">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          <span>{t("categories.showHidden", { count: String(hiddenCount) })}</span>
        </label>
        <span className="cat-toolbar-end">
          <AddButton
            label={t("categories.newGroup")}
            onClick={() => setOpen({ kind: "name", target: { kind: "newGroup" } })}
          />
          <AddButton
            primary
            label={t("categories.newCategory")}
            onClick={() => setOpen({ kind: "name", target: { kind: "newCategory" } })}
          />
        </span>
      </div>
      {/* BUD-01@PoC «Стани» «Порожній»: the system tree is always there; with no custom category yet — the hint. */}
      {!hasCustom ? <p className="ws-muted cat-hint">{t("categories.emptyHint")}</p> : null}
      {failure ? <ActionError failure={failure} /> : null}
      {groups.length === 0 ? (
        <p className="ws-card cat-nothing" role="status">
          {t("categories.nothingFound")}
        </p>
      ) : (
        <div className="ws-card cat-tree">
          {groups.map(({ group, shown, found }) => {
            // A search opens every group it finds something in.
            const expanded = q !== "" || !collapsed.has(group.id);
            return (
              <GroupBlock
                key={group.id}
                group={group}
                count={shown.length}
                categories={found}
                expanded={expanded}
                onToggle={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  })
                }
                onRename={() =>
                  setOpen({ kind: "name", target: { kind: "renameGroup", id: group.id, name: group.name } })
                }
                onNewCategory={() =>
                  setOpen({ kind: "name", target: { kind: "newCategory", groupId: group.id } })
                }
                menuOf={(c) =>
                  categoryMenu(t, c, {
                    rename: () =>
                      setOpen({ kind: "name", target: { kind: "renameCategory", id: c.id, name: c.name } }),
                    appearance: () => setOpen({ kind: "appearance", category: c }),
                    essential: () => void patch(c, { essential: !c.essential }),
                    merge: () => setOpen({ kind: "merge", category: c }),
                    hide: () => void patch(c, { hidden: !c.hidden }),
                    remove: () => setOpen({ kind: "delete", category: c }),
                  })
                }
              />
            );
          })}
        </div>
      )}
      <NameDialog
        target={open.kind === "name" ? open.target : null}
        groups={tree.groups}
        onClose={close}
        onDone={() => {
          close();
          reload();
        }}
      />
      <AppearanceDialog
        category={open.kind === "appearance" ? open.category : null}
        tree={tree}
        onClose={close}
        onDone={() => {
          close();
          reload();
        }}
      />
      <MergeDialog
        category={open.kind === "merge" ? open.category : null}
        tree={tree}
        onClose={close}
        onDone={() => {
          close();
          reload();
        }}
      />
      <DeleteDialog
        category={open.kind === "delete" ? open.category : null}
        onClose={close}
        onDone={() => {
          close();
          reload();
        }}
      />
    </>
  );
}

/**
 * «Нова група» and «Нова категорія» with «+» — the markup of the design-system `Button` (CMP-01), written out as on
 * «Рахунки» because the plan-name lint rule exempts the icon name only on `<Icon name>`.
 */
function AddButton({
  label,
  primary = false,
  onClick,
}: {
  label: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ws-button${primary ? " ws-button-primary" : ""} ws-button-with-icon`}
      onClick={onClick}
    >
      <span className="ws-button-slot" aria-hidden="true">
        <Icon name="plus" size={16} inButton />
      </span>
      <span className="ws-button-label">{label}</span>
    </button>
  );
}

/** «Помилка. Не вдалося зберегти зміни…» with the support code; the tree keeps what the server has. */
function ActionError({ failure }: { failure: ActionFailure }) {
  const t = useT();
  return (
    <div className="cat-failure" role="alert">
      <p>{t("categories.error.action")}</p>
      {failure.kind === "other" && failure.supportId ? (
        <p className="ws-muted">{t("categories.code", { code: failure.supportId })}</p>
      ) : null}
    </div>
  );
}

const KIND_KEYS = {
  expense: "categories.kind.expense",
  income: "categories.kind.income",
  service: "categories.kind.service",
} as const;

function GroupBlock({
  group,
  count,
  categories,
  expanded,
  onToggle,
  onRename,
  onNewCategory,
  menuOf,
}: {
  group: Group;
  count: number;
  categories: readonly Category[];
  expanded: boolean;
  onToggle: () => void;
  onRename: () => void;
  onNewCategory: () => void;
  menuOf: (c: Category) => { items: MenuItem[]; note?: string | undefined };
}) {
  const t = useT();
  const listId = `cat-group-${group.id}`;
  const groupItems: MenuItem[] = [
    { id: "rename", label: t("categories.action.rename"), icon: "edit", onSelect: onRename },
    { id: "new", label: t("categories.action.newInGroup"), icon: "list", onSelect: onNewCategory },
  ];
  return (
    <section className="cat-group" aria-labelledby={`${listId}-name`}>
      <div className="cat-group-head">
        <h2 className="cat-group-title">
          <button
            type="button"
            className="cat-group-toggle"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={onToggle}
          >
            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={16} />
            <span id={`${listId}-name`} className="cat-group-name">
              {group.name}
            </span>
            <span className="cat-group-meta">
              {t("categories.group.meta", { count: String(count), kind: t(KIND_KEYS[group.kind]) })}
            </span>
          </button>
        </h2>
        {/* The service group is fixed: no custom categories in it, and its name is the product's. */}
        {group.kind !== "service" ? (
          <MoreButton label={t("categories.menu.group", { name: group.name })} items={groupItems} />
        ) : null}
      </div>
      {expanded ? (
        <ul id={listId} className="cat-list">
          {categories.map((c) => {
            const menu = menuOf(c);
            return (
              <li key={c.id} className="cat-row">
                <CategoryDisc color={c.color} icon={c.icon} iconTone={c.iconTone} />
                <span className="cat-name">{c.name}</span>
                {c.essential ? <Badge label={t("categories.badge.essential")} /> : null}
                {c.hidden ? <Badge label={t("categories.badge.hidden")} /> : null}
                {c.systemKey === null ? <Badge label={t("categories.badge.custom")} tone="info" /> : null}
                <MoreButton
                  label={t("categories.menu.category", { name: c.name })}
                  items={menu.items}
                  note={menu.note}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function MoreButton({ label, items, note }: { label: string; items: MenuItem[]; note?: string | undefined }) {
  const t = useT();
  return (
    <span className="cat-more">
      <MenuButton
        menuLabel={label}
        ariaLabel={t("categories.more")}
        title={t("categories.more")}
        placement="down"
        align="end"
        className="ws-icon-button"
        items={items}
        note={note}
      >
        <Icon name="more" size={20} inButton />
      </MenuButton>
    </span>
  );
}

interface MenuActions {
  rename: () => void;
  appearance: () => void;
  essential: () => void;
  merge: () => void;
  hide: () => void;
  remove: () => void;
}

/**
 * The «…» of a category (board: «Перейменувати», «Іконка і колір» | «Об’єднати з іншою…», «Приховати»):
 * - «Обов’язкова» — a check item, expenses only (FR 11, AC15);
 * - merge and hide — not for «Переказ» and «Коригування» (FR 3); a hidden category shows «Показати» instead of
 *   «Приховати» and is not merged (the server refuses a hidden source as it refuses a hidden target);
 * - «Видалити» — last, only when the server says the category is custom and empty (FR 12, AC18); a custom category
 *   that is not empty gets the explanation instead (AC19); a system one never offers it (AC7).
 */
function categoryMenu(
  t: ReturnType<typeof useT>,
  c: Category,
  act: MenuActions,
): { items: MenuItem[]; note?: string | undefined } {
  const items: MenuItem[] = [
    { id: "rename", label: t("categories.action.rename"), icon: "edit", onSelect: act.rename },
    { id: "appearance", label: t("categories.action.appearance"), icon: "art", onSelect: act.appearance },
  ];
  if (c.kind === "expense")
    items.push({
      id: "essential",
      label: t("categories.action.essential"),
      icon: "star",
      checked: c.essential === true,
      separator: true,
      onSelect: act.essential,
    });
  if (c.kind !== "service") {
    if (!c.hidden)
      items.push({
        id: "merge",
        label: t("categories.action.merge"),
        icon: "plans",
        separator: c.kind !== "expense",
        onSelect: act.merge,
      });
    items.push(
      c.hidden
        ? { id: "show", label: t("categories.action.show"), icon: "eye", onSelect: act.hide }
        : { id: "hide", label: t("categories.action.hide"), icon: "eye-off", onSelect: act.hide },
    );
  }
  if (c.deletable)
    items.push({
      id: "delete",
      label: t("categories.action.delete"),
      icon: "trash",
      danger: true,
      onSelect: act.remove,
    });
  const note = c.systemKey === null && !c.deletable ? t("categories.notDeletable") : undefined;
  return { items, note };
}
