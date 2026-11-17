import { useI18n } from "@willowsum/i18n";
import { EmptyState, ErrorState, NoAccessState, PartialDataBanner, Skeleton } from "@willowsum/ui";

/**
 * DAT-05@PoC «Стани екранів» in the design-system gallery: every state on synthetic values — the empty state in both
 * placements and without the right to add, loading with «Ще завантажується…» shown, the error in both placements next
 * to a card that keeps working, partial data, and «Немає доступу» for a module and for a widget.
 */
export function StatesDemo() {
  const { t } = useI18n();
  const noop = () => undefined;
  return (
    <div className="gallery-states">
      <p className="ws-muted">{t("gallery.states.intro")}</p>

      <figure className="gallery-states__case" data-case="state-empty-area">
        <figcaption className="ws-text-label ws-muted">{t("gallery.states.emptyArea")}</figcaption>
        <div className="ws-card">
          <EmptyState
            placement="area"
            icon="transactions"
            title={t("gallery.states.tx.emptyTitle")}
            text={t("gallery.states.tx.emptyText")}
            primary={{ label: t("action.importStatement"), onClick: noop }}
            secondary={{ label: t("gallery.states.tx.add"), onClick: noop }}
          />
        </div>
      </figure>

      <div className="gallery-states__grid">
        <figure className="gallery-states__case" data-case="state-empty-block">
          <figcaption className="ws-text-label ws-muted">{t("gallery.states.emptyBlock")}</figcaption>
          <div className="ws-card">
            <EmptyState
              placement="block"
              icon="budget"
              title={t("gallery.states.budget.emptyTitle")}
              text={t("gallery.states.budget.emptyText")}
              primary={{ label: t("gallery.states.budget.create"), onClick: noop }}
            />
          </div>
        </figure>
        <figure className="gallery-states__case" data-case="state-empty-no-rights">
          <figcaption className="ws-text-label ws-muted">{t("gallery.states.emptyNoRights")}</figcaption>
          <div className="ws-card">
            <EmptyState
              placement="block"
              icon="budget"
              title={t("gallery.states.budget.emptyTitle")}
              text={t("gallery.states.budget.emptyText")}
              primary={{ label: t("gallery.states.budget.create"), onClick: noop, allowed: false }}
            />
          </div>
        </figure>
        <figure className="gallery-states__case" data-case="state-loading">
          <figcaption className="ws-text-label ws-muted">{t("gallery.states.loading")}</figcaption>
          <div className="ws-card">
            <Skeleton variant="row" lines={3} slow />
          </div>
        </figure>
      </div>

      <figure className="gallery-states__case" data-case="state-error-area">
        <figcaption className="ws-text-label ws-muted">{t("gallery.states.errorArea")}</figcaption>
        <div className="ws-card">
          <ErrorState placement="area" text={t("gallery.states.tx.errorText")} code="TX-503" onRetry={noop} />
        </div>
      </figure>

      <figure className="gallery-states__case" data-case="state-error-block">
        <figcaption className="ws-text-label ws-muted">{t("gallery.states.errorBlock")}</figcaption>
        <div className="gallery-states__pair">
          <div className="ws-card">
            <ErrorState text={t("gallery.states.budget.errorText")} code="BUD-500" onRetry={noop} />
          </div>
          <div className="ws-card">
            <p className="ws-muted">{t("gallery.states.budget.card")}</p>
            <p className="ws-text-amount-l">{t("gallery.states.budget.cardValue")}</p>
          </div>
        </div>
      </figure>

      <figure className="gallery-states__case" data-case="state-partial">
        <figcaption className="ws-text-label ws-muted">{t("gallery.states.partial")}</figcaption>
        <PartialDataBanner importHref="#/money/import-history" text={t("gallery.states.partial.text")} />
      </figure>

      <div className="gallery-states__grid">
        <figure className="gallery-states__case" data-case="state-no-access-page">
          <figcaption className="ws-text-label ws-muted">{t("gallery.states.noAccessPage")}</figcaption>
          <div className="ws-card">
            <NoAccessState
              scope="page"
              headingLevel={2}
              title={t("noAccess.title")}
              text={t("noAccess.body")}
              action={{ label: t("noAccess.home"), href: "#/" }}
            />
          </div>
        </figure>
        <figure className="gallery-states__case" data-case="state-no-access-widget">
          <figcaption className="ws-text-label ws-muted">{t("gallery.states.noAccessWidget")}</figcaption>
          <div className="ws-card">
            <NoAccessState scope="widget" title={t("noAccess.title")} text={t("noAccess.widget.body")} />
          </div>
        </figure>
      </div>
    </div>
  );
}
