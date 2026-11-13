import { useState } from "react";
import { formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import { Icon, Skeleton, space } from "@willowsum/ui";

/**
 * CMP-22@PoC Skeleton in the design-system gallery: every variant on synthetic values, «Ще завантажується…» shown
 * at once (`slow`), and a list that swaps between the skeleton and its content so the heading above and the block
 * below can be seen (and measured, e2e) not to move.
 */
const TRANSACTIONS: readonly { name: MessageKey; value: string }[] = [
  { name: "gallery.skeleton.tx1", value: "-1234.50" },
  { name: "gallery.skeleton.tx2", value: "-890.00" },
  { name: "gallery.skeleton.tx3", value: "-312.40" },
];

export function SkeletonDemo() {
  const { t, locale } = useI18n();
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="gallery-skeleton">
      <p className="ws-muted">{t("gallery.skeleton.intro")}</p>
      <div className="gallery-skeleton__grid">
        <figure className="gallery-skeleton__case" data-case="tile">
          <figcaption className="ws-text-label ws-muted">{t("gallery.skeleton.tile")}</figcaption>
          <div className="ws-card">
            <Skeleton variant="row" lines={4} />
          </div>
        </figure>
        <figure className="gallery-skeleton__case" data-case="circle">
          <figcaption className="ws-text-label ws-muted">{t("gallery.skeleton.circle")}</figcaption>
          <div className="ws-card">
            <Skeleton variant="row" leading="circle" lines={4} />
          </div>
        </figure>
        <figure className="gallery-skeleton__case" data-case="text">
          <figcaption className="ws-text-label ws-muted">{t("gallery.skeleton.text")}</figcaption>
          <div className="ws-card">
            <Skeleton variant="text" slow />
          </div>
        </figure>
        <figure className="gallery-skeleton__case" data-case="block">
          <figcaption className="ws-text-label ws-muted">{t("gallery.skeleton.block")}</figcaption>
          <div className="ws-card">
            <Skeleton variant="block" height={space["space-8"] * 2} />
          </div>
        </figure>
        <figure className="gallery-skeleton__case" data-case="field">
          <figcaption className="ws-text-label ws-muted">{t("gallery.skeleton.field")}</figcaption>
          <div className="ws-card">
            <Skeleton variant="block" field />
          </div>
        </figure>
      </div>

      <figure className="gallery-skeleton__case gallery-skeleton__swap" data-case="swap">
        <figcaption className="ws-text-label ws-muted">{t("gallery.skeleton.swap")}</figcaption>
        <div>
          <button type="button" className="ws-button" onClick={() => setLoaded((v) => !v)}>
            {t(loaded ? "gallery.skeleton.showSkeleton" : "gallery.skeleton.showContent")}
          </button>
        </div>
        <section className="ws-card gallery-skeleton__list" aria-labelledby="g-skeleton-list">
          <h3 id="g-skeleton-list" className="ws-text-heading-3">
            {t("gallery.skeleton.list")}
          </h3>
          {loaded ? (
            <ul className="gallery-skeleton__rows">
              {TRANSACTIONS.map((tx) => (
                <li key={tx.name} className="gallery-skeleton__row">
                  <span className="gallery-skeleton__logo">
                    <Icon name="transactions" size={20} />
                  </span>
                  <span className="gallery-skeleton__text">
                    <span>{t(tx.name)}</span>
                    <span className="ws-muted">{t("gallery.skeleton.category")}</span>
                  </span>
                  <span className="ws-num">{formatMoney(locale, tx.value, "UAH")}</span>
                </li>
              ))}
            </ul>
          ) : (
            // Default timing: after 3 s «Ще завантажується…» appears here too, and the e2e test checks nothing moves.
            <Skeleton variant="row" lines={TRANSACTIONS.length} />
          )}
        </section>
        <div className="ws-card gallery-skeleton__neighbour">{t("gallery.skeleton.neighbour")}</div>
      </figure>
    </div>
  );
}
