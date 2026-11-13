import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n, type MessageKey } from "@willowsum/i18n";
import {
  Amount,
  breakpoints,
  CHART_FILL_STEPS,
  colors,
  COLOR_TOKEN_NAMES,
  componentTypeScale,
  CONTRAST_MINIMUM,
  CONTRAST_PAIRS,
  contrastRatio,
  cssVar,
  fontFamilies,
  formatRatio,
  HideAmountsSwitch,
  Icon,
  ICON_PARENT_CHILD,
  IconButton,
  IconTile,
  layers,
  MAIN_ID,
  mediaQueries,
  motion,
  Percent,
  POC_ICON_GROUPS,
  PRODUCT_ICONS,
  radii,
  space,
  THEME_ONLY_PAIRS,
  THEMES,
  ThemeSwitch,
  typeScale,
  useMediaQuery,
  widthClasses,
  WillowsumMark,
  type ContrastPair,
  type PocIconGroup,
  type ProductKind,
  type ThemeName,
  type TypeStyle,
  type WidthClass,
} from "@willowsum/ui";
import { offeredLanguages } from "../i18n/languages.ts";
import { AmountFitDemo } from "./AmountFitDemo.tsx";
import { SkeletonDemo } from "./SkeletonDemo.tsx";
import { TooltipDemo } from "./TooltipDemo.tsx";
import { useDocumentTitle } from "../useDocumentTitle.ts";

const THEME_LABEL: Record<ThemeName, MessageKey> = { light: "theme.light", dark: "theme.dark" };
const WIDTH_LABEL: Record<WidthClass, MessageKey> = {
  narrow: "gallery.width.narrow",
  medium: "gallery.width.medium",
  wide: "gallery.width.wide",
  large: "gallery.width.large",
};
const WIDTH_NAV: Record<WidthClass, MessageKey> = {
  narrow: "gallery.nav.bottom",
  medium: "gallery.nav.rail",
  wide: "gallery.nav.railOrSidebar",
  large: "gallery.nav.sidebar",
};
const ICON_GROUP_LABEL: Record<PocIconGroup, MessageKey> = {
  sections: "gallery.icons.group.sections",
  money: "gallery.icons.group.money",
  actions: "gallery.icons.group.actions",
  navigation: "gallery.icons.group.navigation",
  status: "gallery.icons.group.status",
};
const PRODUCT_LABEL: Record<ProductKind, MessageKey> = {
  account: "gallery.icons.product.account",
  card: "gallery.icons.product.card",
  loan: "gallery.icons.product.loan",
  mortgage: "gallery.icons.product.mortgage",
  goal: "gallery.icons.product.goal",
  other: "gallery.icons.product.other",
};
/** DS-12@PoC item 9: the PoC parent → child pairs (the mortgage); insurance and investment kinds are PoC v2. */
const POC_PAIRS = ICON_PARENT_CHILD.filter(([, child]) =>
  (POC_ICON_GROUPS.money as readonly string[]).includes(child),
);

/** Synthetic sample data only (DS-22 item 6). */
const SAMPLE = {
  total: "284 650,00 ₴",
  account: "312 400,50 ₴",
  row: "−1 249,90 ₴",
  change: "+30 120,00 ₴",
  changePercent: "+2,4 %",
};

const swatch = (token: string): CSSProperties => ({ background: cssVar(token) });

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="gallery-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

/** Renders its children in one theme, whatever the page theme is. */
function ThemePanel({ theme, children }: { theme: ThemeName; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="gallery-theme-panel" data-theme={theme}>
      <h3>{t("gallery.themeColumn", { theme: t(THEME_LABEL[theme]) })}</h3>
      {children}
    </div>
  );
}

function ColorSwatches({ theme }: { theme: ThemeName }) {
  return (
    <ul className="gallery-swatches">
      {COLOR_TOKEN_NAMES.map((name) => (
        <li key={name} className="gallery-swatch">
          <span className="gallery-chip" style={swatch(name)} aria-hidden="true" />
          <span className="gallery-swatch-text">
            <code>{name}</code>
            <span className="ws-muted ws-tabular">{colors[name][theme]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ContrastTable({ theme }: { theme: ThemeName }) {
  const { t } = useI18n();
  const pairs: ContrastPair[] = [...CONTRAST_PAIRS, ...THEME_ONLY_PAIRS.filter((p) => p.theme === theme)];
  const label = (key: MessageKey) => t(key);
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        <thead>
          <tr>
            <th scope="col">{t("gallery.col.sample")}</th>
            <th scope="col">{t("gallery.col.pair")}</th>
            <th scope="col">{t("gallery.col.kind")}</th>
            <th scope="col">{t("gallery.col.ratio")}</th>
            <th scope="col">{t("gallery.col.result")}</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => {
            const ratio = contrastRatio(colors[p.fg][theme], colors[p.bg][theme]);
            const min = CONTRAST_MINIMUM[p.kind];
            const pass = ratio >= min;
            return (
              <tr key={`${p.fg}/${p.bg}/${p.kind}`}>
                <td data-label={label("gallery.col.sample")}>
                  <span
                    className="gallery-contrast-sample"
                    // The sample of a non-text pair (3 : 1) is a swatch drawn with letters; the end-to-end contrast
                    // check (apps/web/e2e/contrast.ts, DS-06 AC2) holds it to that pair's own minimum.
                    data-contrast-kind={p.kind}
                    style={{ background: cssVar(p.bg), color: cssVar(p.fg) }}
                  >
                    {t("gallery.contrastSample")}
                  </span>
                </td>
                <td data-label={label("gallery.col.pair")}>
                  <code>{t("gallery.pairOn", { fg: p.fg, bg: p.bg })}</code>
                </td>
                <td data-label={label("gallery.col.kind")}>
                  {t(p.kind === "text" ? "gallery.kind.text" : "gallery.kind.ui")}
                </td>
                <td data-label={label("gallery.col.ratio")} className="ws-tabular">
                  {formatRatio(ratio)} : 1 <span className="ws-muted">(≥ {min})</span>
                </td>
                <td data-label={label("gallery.col.result")} className={pass ? "ws-gain" : "ws-loss"}>
                  {t(pass ? "gallery.pass" : "gallery.fail")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChartPalette() {
  const tokens = [
    ...CHART_FILL_STEPS.map((_, i) => `chart-${i + 1}`),
    "chart-other-hatch",
    "chart-area-5",
    "heat-0",
    "heat-1",
    "heat-2",
    "heat-3",
    "heat-4",
    "chart-loss-hatch",
  ];
  return (
    <ul className="gallery-swatches">
      {tokens.map((token) => (
        <li key={token} className="gallery-swatch">
          <span className="gallery-chip" style={swatch(token)} aria-hidden="true" />
          <code>{token}</code>
        </li>
      ))}
    </ul>
  );
}

function TypeRow({ name, style }: { name: string; style: TypeStyle }) {
  const { t } = useI18n();
  return (
    <li className="gallery-type-row">
      <code>{name}</code>
      <span className={`ws-text-${name} gallery-type-sample`}>{t("gallery.typeSample")}</span>
      <span className="ws-muted">
        {t("gallery.typeMeta", {
          family: style.family === "display" ? "Inter Tight" : "Inter",
          size: style.size,
          lineHeight: style.lineHeight,
          weight: style.weight,
          tracking: `${style.tracking * 100} %`,
        })}
      </span>
    </li>
  );
}

/** CMP-33@PoC, DS-12@PoC item 6: icon-only buttons — each with a name, shown as its tooltip (CMP-25@PoC). */
function IconButtonsDemo() {
  const { t } = useI18n();
  const [filtered, setFiltered] = useState(false);
  return (
    <>
      <p className="ws-muted">{t("gallery.iconButtons.intro")}</p>
      <div className="gallery-icon-buttons">
        <IconButton icon="options" label={t("gallery.iconButtons.options")} />
        <IconButton icon="columns" label={t("gallery.iconButtons.columns")} />
        <IconButton icon="sort" label={t("gallery.iconButtons.sort")} />
        <IconButton
          icon="filter"
          label={t("gallery.iconButtons.filter")}
          pressed={filtered}
          onClick={() => setFiltered((v) => !v)}
        />
        <IconButton icon="edit" label={t("gallery.iconButtons.edit")} />
        <IconButton icon="settings" label={t("gallery.iconButtons.settings")} />
        <IconButton icon="close" label={t("gallery.iconButtons.close")} />
      </div>
    </>
  );
}

function CurrentWidth() {
  const { t } = useI18n();
  const medium = useMediaQuery(mediaQueries.medium);
  const wide = useMediaQuery(mediaQueries.wide);
  const large = useMediaQuery(mediaQueries.large);
  const cls: WidthClass = large ? "large" : wide ? "wide" : medium ? "medium" : "narrow";
  return <p aria-live="polite">{t("gallery.currentWidth", { cls: t(WIDTH_LABEL[cls]) })}</p>;
}

/** DS-22: the design-system sample page. Not linked from the app navigation; closed to indexing. */
export function GalleryTokensPage() {
  const { t, locale, setLocale } = useI18n();
  useDocumentTitle(t("gallery.title"));

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  return (
    <main id={MAIN_ID} className="gallery" tabIndex={-1}>
      <header className="gallery-header">
        <WillowsumMark size={40} />
        <h1>{t("gallery.title")}</h1>
        <p className="ws-muted gallery-intro">{t("gallery.intro")}</p>
      </header>

      <section className="gallery-controls ws-card" aria-label={t("gallery.controls")}>
        <ThemeSwitch />
        <fieldset className="ws-segmented">
          <legend className="ws-segmented-legend">{t("language.label")}</legend>
          <div className="ws-segmented-options">
            {offeredLanguages(import.meta.env.MODE).map((l) => (
              <label key={l.code} className="ws-segmented-option" lang={l.code}>
                <input
                  type="radio"
                  name="gallery-language"
                  value={l.code}
                  checked={locale === l.code}
                  onChange={() => setLocale(l.code)}
                />
                <span>{l.nativeName}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <HideAmountsSwitch />
      </section>

      <Section id="g-colors" title={t("gallery.section.colors")}>
        <div className="gallery-themes">
          {THEMES.map((theme) => (
            <ThemePanel key={theme} theme={theme}>
              <ColorSwatches theme={theme} />
            </ThemePanel>
          ))}
        </div>
      </Section>

      <Section id="g-contrast" title={t("gallery.section.contrast")}>
        <div className="gallery-themes">
          {THEMES.map((theme) => (
            <ThemePanel key={theme} theme={theme}>
              <ContrastTable theme={theme} />
            </ThemePanel>
          ))}
        </div>
      </Section>

      <Section id="g-chart" title={t("gallery.section.chart")}>
        <div className="gallery-themes">
          {THEMES.map((theme) => (
            <ThemePanel key={theme} theme={theme}>
              <ChartPalette />
            </ThemePanel>
          ))}
        </div>
      </Section>

      <Section id="g-amounts" title={t("gallery.section.amounts")}>
        <dl className="gallery-amounts">
          <div>
            <dt className="ws-text-label ws-muted">{t("gallery.amounts.total")}</dt>
            <dd>
              <Amount value={SAMPLE.total} size="amount-xl" />
            </dd>
          </div>
          <div>
            <dt className="ws-text-label ws-muted">{t("gallery.amounts.account")}</dt>
            <dd>
              <Amount value={SAMPLE.account} size="amount-l" />
            </dd>
          </div>
          <div>
            <dt className="ws-text-label ws-muted">{t("gallery.amounts.row")}</dt>
            <dd>
              <Amount value={SAMPLE.row} size="amount-s" />
            </dd>
          </div>
          <div>
            <dt className="ws-text-label ws-muted">{t("gallery.amounts.change")}</dt>
            <dd className="ws-gain ws-text-amount-s">
              <span aria-hidden="true">▲ </span>
              <Percent value={SAMPLE.changePercent} /> (<Amount value={SAMPLE.change} />)
            </dd>
          </div>
        </dl>
      </Section>

      <Section id="g-fit" title={t("gallery.fit.title")}>
        <AmountFitDemo />
      </Section>

      <Section id="g-tooltip" title={t("gallery.tooltip.title")}>
        <TooltipDemo />
      </Section>

      <Section id="g-skeleton" title={t("gallery.skeleton.title")}>
        <SkeletonDemo />
      </Section>

      <Section id="g-type" title={t("gallery.section.typography")}>
        <p className="ws-muted">
          <code>{fontFamilies.display}</code> · <code>{fontFamilies.sans}</code>
        </p>
        <ul className="gallery-type">
          {Object.entries(typeScale).map(([name, style]) => (
            <TypeRow key={name} name={name} style={style} />
          ))}
          {Object.entries(componentTypeScale).map(([name, style]) => (
            <TypeRow key={name} name={name} style={style} />
          ))}
        </ul>
      </Section>

      <Section id="g-space" title={t("gallery.section.spacing")}>
        <ul className="gallery-scale">
          {Object.entries(space).map(([name, px]) => (
            <li key={name}>
              <code>{name}</code>
              <span className="ws-tabular ws-muted">{t("gallery.unit.px", { value: px })}</span>
              <span className="gallery-space-bar" style={{ inlineSize: cssVar(name) }} aria-hidden="true" />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="g-radii" title={t("gallery.section.radii")}>
        <ul className="gallery-boxes">
          {Object.entries(radii).map(([name, px]) => (
            <li key={name}>
              <span
                className="gallery-radius-box"
                style={{ borderRadius: cssVar(name) }}
                aria-hidden="true"
              />
              <code>{name}</code>
              <span className="ws-tabular ws-muted">{t("gallery.unit.px", { value: px })}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="g-shadows" title={t("gallery.section.shadows")}>
        <div className="gallery-themes">
          {THEMES.map((theme) => (
            <ThemePanel key={theme} theme={theme}>
              <div className="gallery-elevation">
                <div className="ws-card">{t("gallery.flat")}</div>
                <div className="ws-card ws-card-raised">{t("gallery.raised")}</div>
                <div className="gallery-overlay-sample">
                  <span className="gallery-overlay-scrim" aria-hidden="true" />
                  <span className="gallery-overlay-label">{t("gallery.overlay")}</span>
                </div>
              </div>
            </ThemePanel>
          ))}
        </div>
      </Section>

      <Section id="g-layers" title={t("gallery.section.layers")}>
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead>
              <tr>
                <th scope="col">{t("gallery.col.layer")}</th>
                <th scope="col">{t("gallery.col.value")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(layers).map(([name, value]) => (
                <tr key={name}>
                  <td data-label={t("gallery.col.layer")}>
                    <code>{name}</code>
                  </td>
                  <td data-label={t("gallery.col.value")} className="ws-tabular">
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="g-motion" title={t("gallery.section.motion")}>
        <div className="gallery-motion">
          <span className="ws-spinner" role="img" aria-label={t("gallery.motion.spinner")} />
          <span className="gallery-skeleton-demo" role="img" aria-label={t("gallery.motion.skeleton")}>
            <span className="ws-skeleton" />
            <span className="ws-skeleton" />
          </span>
        </div>
        <p className="ws-muted">{t("gallery.motion.reduced")}</p>
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead>
              <tr>
                <th scope="col">{t("gallery.col.token")}</th>
                <th scope="col">{t("gallery.col.duration")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(motion).map(([name, ms]) => (
                <tr key={name}>
                  <td data-label={t("gallery.col.token")}>
                    <code>{name}</code>
                  </td>
                  <td data-label={t("gallery.col.duration")} className="ws-tabular">
                    {t("gallery.unit.ms", { value: ms })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="g-breakpoints" title={t("gallery.section.breakpoints")}>
        <CurrentWidth />
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead>
              <tr>
                <th scope="col">{t("gallery.col.class")}</th>
                <th scope="col">{t("gallery.col.range")}</th>
                <th scope="col">{t("gallery.col.columns")}</th>
                <th scope="col">{t("gallery.col.margin")}</th>
                <th scope="col">{t("gallery.col.gutter")}</th>
                <th scope="col">{t("gallery.col.navigation")}</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(widthClasses) as WidthClass[]).map((cls) => {
                const w = widthClasses[cls];
                const from = cls === "narrow" ? breakpoints.min : w.from;
                return (
                  <tr key={cls}>
                    <td data-label={t("gallery.col.class")}>{t(WIDTH_LABEL[cls])}</td>
                    <td data-label={t("gallery.col.range")} className="ws-tabular">
                      {w.to === null
                        ? t("gallery.range.from", { from })
                        : t("gallery.range.between", { from, to: w.to })}
                    </td>
                    <td data-label={t("gallery.col.columns")} className="ws-tabular">
                      {w.columns}
                    </td>
                    <td data-label={t("gallery.col.margin")} className="ws-tabular">
                      {t("gallery.unit.px", { value: w.margin })}
                    </td>
                    <td data-label={t("gallery.col.gutter")} className="ws-tabular">
                      {t("gallery.unit.px", { value: w.gutter })}
                    </td>
                    <td data-label={t("gallery.col.navigation")}>{t(WIDTH_NAV[cls])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="g-icons" title={t("gallery.section.icons")}>
        {(Object.keys(POC_ICON_GROUPS) as PocIconGroup[]).map((group) => (
          <div key={group} className="gallery-icon-group">
            <h3>{t(ICON_GROUP_LABEL[group])}</h3>
            <ul className="gallery-icons">
              {POC_ICON_GROUPS[group].map((name) => (
                <li key={name}>
                  <Icon name={name} size={24} />
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <h3>{t("gallery.icons.products")}</h3>
        <ul className="gallery-icons">
          {(Object.keys(PRODUCT_ICONS) as ProductKind[]).map((kind) => (
            <li key={kind}>
              <Icon name={PRODUCT_ICONS[kind]} size={24} />
              <span>{t(PRODUCT_LABEL[kind])}</span>
            </li>
          ))}
        </ul>
        <h3>{t("gallery.icons.parentChild")}</h3>
        <ul className="gallery-icons gallery-icons--pairs">
          {POC_PAIRS.map(([parent, child]) => (
            <li key={child}>
              <span className="gallery-icon-pair">
                <Icon name={parent} size={32} />
                <Icon name={child} size={32} />
              </span>
              <code>
                {parent} → {child}
              </code>
            </li>
          ))}
        </ul>
        <h3>{t("gallery.icons.sizes")}</h3>
        <ul className="gallery-icon-sizes">
          {([16, 20, 24, 32, 40] as const).map((size) => (
            <li key={size}>
              <Icon name="budget" size={size} />
              <span className="ws-tabular ws-muted">{t("gallery.unit.px", { value: size })}</span>
            </li>
          ))}
        </ul>
        <h3>{t("gallery.icons.tiles")}</h3>
        <ul className="gallery-icon-tiles">
          <li>
            <IconTile icon="budget" label={t("shell.nav.budget")} />
          </li>
          <li>
            <IconTile icon="recurring" label={t("gallery.icons.tileLong")} />
          </li>
        </ul>
      </Section>

      <Section id="g-icon-buttons" title={t("gallery.section.iconButtons")}>
        <IconButtonsDemo />
      </Section>

      <Section id="g-brand" title={t("gallery.section.brand")}>
        <div className="gallery-themes">
          {THEMES.map((theme) => (
            <ThemePanel key={theme} theme={theme}>
              <div className="gallery-marks">
                <WillowsumMark size={64} />
                <WillowsumMark size={24} />
                <WillowsumMark size={16} />
                <span className="ws-muted">
                  {t(theme === "light" ? "gallery.mark.light" : "gallery.mark.dark")}
                </span>
              </div>
            </ThemePanel>
          ))}
        </div>
      </Section>
    </main>
  );
}
