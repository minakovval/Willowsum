import { cleanup, render } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { STATUS_DICTIONARY } from "../status/dictionary.ts";
import { StatusMark } from "../status/StatusMark.tsx";

/**
 * DS-12@PoC items 8, 10, 11 and 12 on the real markup and the real sources: status marks, and the absence of
 * photos, uploads and illustrations in this release. The icon set itself is in `icons.criteria.test.tsx`.
 */
afterEach(cleanup);

/** The repository root: vitest runs from `packages/ui`. */
const root = resolve(process.cwd(), "../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const full = join(dir, n);
    if (n === "node_modules" || n === "dist") return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const productFiles = [
  ...walk(join(root, "apps/web")),
  ...walk(join(root, "packages/ui")),
  ...walk(join(root, "packages/api-contract")),
].filter((f) => !/node_modules|\.test\./.test(f));
const sources = productFiles.filter(
  (f) => /\.(tsx?|css|html|json)$/.test(f) && !/package(-lock)?\.json$|tsconfig/.test(f),
);
const rel = (f: string) => relative(root, f);

const PARAMS = {
  amount: "2,00 €",
  percent: "86 %",
  date: "5 лис.",
  days: "5",
  count: "3",
  month: "грудень",
  state: "x",
  total: "9",
  covered: "1",
  months: "2",
  fields: "Сума",
};

describe("DS-12@PoC no photos, uploads or illustrations", () => {
  it("DS-12@PoC FR 8: a status mark is never an icon alone — every entry shows its marker with its word, and the word stays in the accessible name when only the marker is drawn", () => {
    const withMarker = STATUS_DICTIONARY.filter((e) => e.marker !== "" && e.family !== "k");
    expect(withMarker.length).toBeGreaterThan(30);
    for (const e of withMarker) {
      const { container, unmount } = render(
        <I18nProvider initialLocale="uk">
          <StatusMark id={e.id} arrow="▲" params={PARAMS} />
        </I18nProvider>,
      );
      const marker = container.querySelector(".ws-status-marker")!;
      const word = container.querySelector(".ws-status-word")!;
      expect(marker.textContent, e.id).not.toBe("");
      expect(word.textContent?.trim().length, e.id).toBeGreaterThan(0);
      expect(container.querySelector("svg"), e.id).toBeNull();
      // The marker and the word are one decorative pair; the reader gets the status once, as a word.
      expect(marker.getAttribute("aria-hidden")).toBe("true");
      expect(container.querySelector(".ws-visually-hidden")!.textContent).toMatch(/^Статус: .+/);
      unmount();
    }
    const { container } = render(
      <I18nProvider initialLocale="uk">
        <StatusMark id={withMarker[0]!.id} arrow="▲" params={PARAMS} markerOnly />
      </I18nProvider>,
    );
    expect(container.querySelector(".ws-status-word")).toBeNull();
    expect(container.querySelector(".ws-visually-hidden")!.textContent).toMatch(/^Статус: .+/);
  });

  it("DS-12@PoC FR 10: no object photos or images — no `<img>`, `<picture>`, image URL or raster file in the product", () => {
    expect(sources.length).toBeGreaterThan(100);
    for (const f of sources.filter((x) => /\.(tsx|html)$/.test(x))) {
      const text = readFileSync(f, "utf8");
      expect(text, rel(f)).not.toMatch(/<img[\s>]|<picture[\s>]|<image[\s>]|new Image\(/);
    }
    for (const f of sources.filter((x) => x.endsWith(".css")))
      expect(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), rel(f)).not.toMatch(/url\(/);
    const files = [...productFiles, ...walk(join(root, "apps/web/public"))];
    expect(files.filter((f) => /\.(png|jpe?g|gif|webp|avif|bmp|heic)$/i.test(f)).map(rel)).toEqual([]);
  });

  it("DS-12@PoC FR 11: real photos cannot be uploaded — no file input, no form upload, no attachment request in the web app or the contract", () => {
    const client = productFiles.filter((f) =>
      /apps\/web\/src|packages\/ui\/src|packages\/api-contract/.test(f),
    );
    for (const f of client.filter((x) => /\.(tsx?|json)$/.test(x))) {
      const text = readFileSync(f, "utf8");
      expect(text, rel(f)).not.toMatch(
        /type=["']file["']|type:\s*["']file["']|new FormData|<input[^>]*accept=/,
      );
      // The contract names its one multipart route (checked below); the web app and the UI kit send none.
      if (!/packages\/api-contract/.test(f)) expect(text, rel(f)).not.toMatch(/multipart\/form-data/);
    }
    const contract = readFileSync(join(root, "packages/api-contract/openapi.json"), "utf8");
    expect(contract).not.toMatch(/image\/(png|jpeg)|"\/[a-z/{}-]*(upload|attachments?|photos?)/i);
    // The one multipart route is the statement upload of an import batch (IMP-01@PoC FR 3): CSV, TSV, XLSX and XLS only,
    // checked by content on the server (ARC-06 FR 4), so no photo can be stored through it.
    const paths = (
      JSON.parse(contract) as { paths: Record<string, Record<string, { requestBody?: unknown }>> }
    ).paths;
    const multipart = Object.entries(paths).flatMap(([path, ops]) =>
      Object.entries(ops)
        .filter(([, op]) => JSON.stringify(op.requestBody ?? {}).includes("multipart/form-data"))
        .map(([method]) => `${method} ${path}`),
    );
    expect(multipart).toEqual(["post /v1/import/batches/{batchId}/files"]);
  });

  it("DS-12@PoC FR 12: no illustrations, mascots or stock photos — the only vector images are the brand mark files and the favicon", () => {
    const svgs = [...walk(join(root, "apps/web")), ...walk(join(root, "packages/ui"))]
      .filter((f) => /\.svg$/.test(f) && !/node_modules/.test(f))
      .map(rel)
      .sort();
    expect(svgs).toEqual([
      "apps/web/public/favicon.svg",
      "packages/ui/src/brand/assets/app-icon.svg",
      "packages/ui/src/brand/assets/mark-dark.svg",
      "packages/ui/src/brand/assets/mark-light.svg",
      "packages/ui/src/brand/assets/mark-mono.svg",
    ]);
  });
});
