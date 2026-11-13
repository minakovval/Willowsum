/**
 * DS-06@PoC AC2: an automatic contrast check of a rendered page in the light theme — text at least 4.5 : 1 against
 * what is behind it, interface elements at least 3 : 1 against what is next to them (WCAG 2.2 SC 1.4.3, 1.4.11).
 *
 * `findContrastProblems` runs inside the page (Playwright serialises it), so it is self-contained. It measures computed
 * styles, not a screenshot:
 * - text: every visible element with its own text; the colour (with the opacity of the element and its ancestors)
 *   over the composited backgrounds of the element and its ancestors. 4.5 : 1 for all text, whatever its size
 *   (DS-06 AC2 names one threshold). Inactive controls (`disabled`, `aria-disabled="true"`) are exempt, as in WCAG;
 *   a swatch of a non-text colour pair drawn with letters (`data-contrast-kind="ui"`, the gallery's contrast
 *   table) is held to 3 : 1;
 * - text inside fields: the value of a text field, text area or list box, and the placeholder of an empty field
 *   (`::placeholder`), over the field's own background, at 4.5 : 1;
 * - interface elements: fields, buttons, links styled as buttons, checkboxes, switches, radios and tabs. An element
 *   drawn by a border or a fill must have one of them at 3 : 1 against the background next to it (its parent's). An
 *   element with neither is identified by its text, checked above. Natively drawn checkboxes and radios are the
 *   browser's own.
 * - anything it cannot measure (a background image or gradient behind text, a colour format it cannot read) is
 *   reported as a problem: the check fails closed instead of passing what it did not see.
 * Not covered here: focus rings (they appear on focus) and states on hover; `::before` / `::after` content and SVG
 * text (no PoC route has them yet; follow-up); what is painted under an element out of DOM order (overlays). The
 * token pairs themselves are checked by the design-system tests.
 */
export interface ContrastProblem {
  readonly kind: "text" | "ui" | "unmeasurable";
  /** A short path to the element, e.g. `main > form > button.ws-button`. */
  readonly element: string;
  /** The first characters of its text. */
  readonly text: string;
  readonly ratio: number;
  readonly required: number;
  readonly foreground: string;
  readonly background: string;
}

export function findContrastProblems(): ContrastProblem[] {
  type Rgba = [number, number, number, number];
  const problems: ContrastProblem[] = [];

  const parse = (value: string): Rgba | null => {
    const v = value.trim();
    if (v === "transparent") return [0, 0, 0, 0];
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
    if (m) {
      const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
      return [Number(m[1]), Number(m[2]), Number(m[3]), a];
    }
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(v);
    if (m) {
      const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
      return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, a];
    }
    return null;
  };
  /** `top` over an opaque `bottom`. */
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const a = top[3];
    return [
      top[0] * a + bottom[0] * (1 - a),
      top[1] * a + bottom[1] * (1 - a),
      top[2] * a + bottom[2] * (1 - a),
      1,
    ];
  };
  const luminance = ([r, g, b]: Rgba) => {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a: Rgba, b: Rgba) => {
    const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (l1 + 0.05) / (l2 + 0.05);
  };
  /** sRGB channels 0–255, e.g. `251 251 250`. */
  const show = (c: Rgba) =>
    c
      .slice(0, 3)
      .map((x) => Math.round(x))
      .join(" ");
  const describe = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      const cls = [...e.classList]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join("");
      parts.unshift(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${cls}`);
    }
    return parts.join(" > ");
  };
  const snippet = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

  /** The opaque colour behind an element: its own background and its ancestors', composited; null when unreadable. */
  const backgroundOf = (el: Element): Rgba | null => {
    const layers: Rgba[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const style = getComputedStyle(e);
      if (style.backgroundImage !== "none") return null;
      const c = parse(style.backgroundColor);
      if (!c) return null;
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    // The canvas under everything is white in the light theme.
    let result: Rgba = [255, 255, 255, 1];
    for (const layer of layers.reverse()) result = over(layer, result);
    return result;
  };
  const opacityOf = (el: Element) => {
    let o = 1;
    for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };
  const visible = (el: Element) => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    // Text for screen readers only (1 px, clipped) is not on screen.
    return r.width > 1 && r.height > 1;
  };
  const inactive = (el: Element) => el.closest(":disabled, [aria-disabled='true']") !== null;

  // Text.
  for (const el of document.body.querySelectorAll("*")) {
    if (el instanceof SVGElement || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName))
      continue;
    const ownText = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && /\S/.test(n.textContent ?? ""),
    );
    if (!ownText || !visible(el) || inactive(el)) continue;
    const bg = backgroundOf(el);
    const fgRaw = parse(getComputedStyle(el).color);
    if (!bg || !fgRaw) {
      problems.push({
        kind: "unmeasurable",
        element: describe(el),
        text: snippet(el),
        ratio: 0,
        required: 4.5,
        foreground: getComputedStyle(el).color,
        background: bg ? show(bg) : "background image or unreadable colour",
      });
      continue;
    }
    const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacityOf(el)], bg);
    const r = ratio(fg, bg);
    const required = el.closest("[data-contrast-kind='ui']") ? 3 : 4.5;
    if (r < required)
      problems.push({
        kind: "text",
        element: describe(el),
        text: snippet(el),
        ratio: Math.round(r * 100) / 100,
        required,
        foreground: show(fg),
        background: show(bg),
      });
  }

  // Text inside fields: their value, or the placeholder of an empty one (the browser draws both, not a text node).
  const NO_TEXT_INPUTS = ["checkbox", "radio", "range", "color", "file", "hidden", "image"];
  const fields = document.body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input, textarea, select",
  );
  for (const el of fields) {
    if (el instanceof HTMLInputElement && NO_TEXT_INPUTS.includes(el.type)) continue;
    if (!visible(el) || inactive(el)) continue;
    const placeholder = "placeholder" in el ? el.placeholder : "";
    const shown = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.text ?? "") : el.value;
    const source = shown.trim() ? "value" : placeholder.trim() ? "placeholder" : null;
    if (!source) continue;
    const colour = getComputedStyle(el, source === "placeholder" ? "::placeholder" : null).color;
    const bg = backgroundOf(el);
    const fgRaw = parse(colour);
    const text = `${source}: ${(source === "value" ? shown : placeholder).slice(0, 50)}`;
    if (!bg || !fgRaw) {
      problems.push({
        kind: "unmeasurable",
        element: describe(el),
        text,
        ratio: 0,
        required: 4.5,
        foreground: colour,
        background: bg ? show(bg) : "background image or unreadable colour",
      });
      continue;
    }
    const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacityOf(el)], bg);
    const r = ratio(fg, bg);
    if (r < 4.5)
      problems.push({
        kind: "text",
        element: describe(el),
        text,
        ratio: Math.round(r * 100) / 100,
        required: 4.5,
        foreground: show(fg),
        background: show(bg),
      });
  }

  // Interface elements.
  const controls = document.body.querySelectorAll(
    "input:not([type='hidden']), select, textarea, button, a.ws-button, [role='checkbox'], [role='switch'], [role='radio'], [role='tab']",
  );
  for (const el of controls) {
    if (!visible(el) || inactive(el)) continue;
    const style = getComputedStyle(el);
    if (
      (el as HTMLInputElement).type &&
      ["checkbox", "radio"].includes((el as HTMLInputElement).type) &&
      style.appearance !== "none"
    )
      continue;
    const adjacent = el.parentElement ? backgroundOf(el.parentElement) : null;
    if (!adjacent) {
      problems.push({
        kind: "unmeasurable",
        element: describe(el),
        text: snippet(el),
        ratio: 0,
        required: 3,
        foreground: "",
        background: "background image or unreadable colour",
      });
      continue;
    }
    const opacity = opacityOf(el);
    const indicators: Rgba[] = [];
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      const width = Number(style.getPropertyValue(`border-${side.toLowerCase()}-width`).replace(/px$/, ""));
      const c = parse(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
      const styleName = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
      if (width >= 1 && styleName !== "none" && styleName !== "hidden" && c && c[3] > 0)
        indicators.push(over([c[0], c[1], c[2], c[3] * opacity], adjacent));
    }
    const fill = parse(style.backgroundColor);
    if (fill && fill[3] > 0 && style.backgroundImage === "none")
      indicators.push(over([fill[0], fill[1], fill[2], fill[3] * opacity], adjacent));
    if (indicators.length === 0) continue;
    const best = indicators.reduce((a, b) => (ratio(b, adjacent) > ratio(a, adjacent) ? b : a));
    const r = ratio(best, adjacent);
    // A fill or border equal to the background draws nothing: the element is then identified by its text.
    if (indicators.every((c) => ratio(c, adjacent) < 1.01)) continue;
    if (r < 3)
      problems.push({
        kind: "ui",
        element: describe(el),
        text: snippet(el),
        ratio: Math.round(r * 100) / 100,
        required: 3,
        foreground: show(best),
        background: show(adjacent),
      });
  }
  return problems;
}
