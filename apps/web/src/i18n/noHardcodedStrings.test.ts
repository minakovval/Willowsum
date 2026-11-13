// @vitest-environment node
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

/**
 * NFR-09@PoC FR 1 (criterion «i18n»: 0 hard-coded strings in the interface, lint rule in CI). The rule
 * `willowsum/no-hardcoded-ui-strings` of the root ESLint config runs in `pnpm lint`. This test fails closed:
 * it checks the real config, so the rule cannot be switched off, downgraded to a warning or narrowed to fewer
 * files without a red test, and an empty file list fails too.
 */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const RULE = "willowsum/no-hardcoded-ui-strings";
const UI_FOLDERS = ["apps/web/src", "packages/ui/src"];
const eslint = new ESLint({ cwd: ROOT });

/** Interface sources: every .tsx under the UI folders except tests and test helpers. */
function interfaceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) && entry.name !== "testing.tsx")
        out.push(relative(ROOT, path));
    }
  };
  for (const folder of UI_FOLDERS) walk(join(ROOT, folder));
  return out;
}

async function messages(code: string, file = "apps/web/src/pages/Sample.tsx") {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return (result?.messages ?? []).filter((m) => m.ruleId === RULE);
}

describe("NFR-09@PoC FR 1: the lint rule against hard-coded interface strings", () => {
  it("NFR-09@PoC FR 1: applies as an error to every interface source file (fails closed)", async () => {
    const files = interfaceFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const config = (await eslint.calculateConfigForFile(join(ROOT, file))) as {
        rules?: Record<string, unknown>;
      };
      const setting = config.rules?.[RULE];
      const level = Array.isArray(setting) ? setting[0] : setting;
      expect([2, "error"], file).toContain(level);
    }
  });

  it("NFR-09@PoC FR 1: reports text written directly in JSX, in apps/web and in packages/ui", async () => {
    expect(await messages("export const A = () => <p>Бюджет</p>;")).toHaveLength(1);
    expect(
      await messages("export const A = () => <p>Budget</p>;", "packages/ui/src/shell/Sample.tsx"),
    ).toHaveLength(1);
  });

  it("NFR-09@PoC FR 1: reports a string literal or template shown as a JSX child, also behind a condition", async () => {
    expect(await messages('export const A = () => <p>{"Save"}</p>;')).toHaveLength(1);
    expect(await messages("export const A = (n: number) => <p>{`${n} px`}</p>;")).toHaveLength(1);
    expect(await messages('export const A = (x: boolean) => <p>{x ? "Yes" : "No"}</p>;')).toHaveLength(2);
    expect(await messages('export const A = (x: boolean) => <p>{x && "Done"}</p>;')).toHaveLength(1);
  });

  it("NFR-09@PoC FR 1: reports a literal in an attribute the user reads or hears", async () => {
    for (const attr of ["aria-label", "title", "placeholder", "alt", "label", "aria-description"]) {
      expect(await messages(`export const A = () => <input ${attr}="Search" />;`), attr).toHaveLength(1);
      expect(await messages(`export const A = () => <input ${attr}={"Search"} />;`), attr).toHaveLength(1);
    }
  });

  it("NFR-09@PoC FR 1: reports alert, confirm and prompt with a literal message", async () => {
    expect(await messages('export const f = () => window.confirm("Delete?");')).toHaveLength(1);
    expect(await messages('export const f = () => alert("Saved");')).toHaveLength(1);
  });

  it("NFR-09@PoC FR 1: allows translated text, symbols, numbers and technical attributes", async () => {
    const ok = [
      'import { useT } from "@willowsum/i18n"; export const A = () => { const t = useT(); return <p title={t("shell.settings")}>{t("shell.settings")}</p>; };',
      "export const A = (n: number) => <p>{n} · — → % € ₴ ✓ 12:30 ( ) , .</p>;",
      'export const A = () => <input type="radio" name="theme" className="ws-x" data-testid="x" id="g-colors" />;',
      'export const A = () => <a href="#/planning/budget" lang="uk" role="img" />;',
      'export const A = () => <p className={"ws-muted"} />;',
    ];
    for (const code of ok) expect(await messages(code), code).toEqual([]);
  });

  it("NFR-09@PoC FR 1: does not apply to tests and translation catalogues", async () => {
    expect(
      await messages("export const A = () => <p>Бюджет</p>;", "apps/web/src/pages/Sample.test.tsx"),
    ).toEqual([]);
    expect(
      await messages("export const uk = { a: <p>Бюджет</p> };", "packages/i18n/src/messages/x.tsx"),
    ).toEqual([]);
  });

  it("NFR-09@PoC FR 1: today's interface sources have no hard-coded strings", async () => {
    const results = await eslint.lintFiles(interfaceFiles().map((f) => join(ROOT, f)));
    const found = results.flatMap((r) =>
      r.messages.filter((m) => m.ruleId === RULE).map((m) => `${relative(ROOT, r.filePath)}:${m.line}`),
    );
    expect(found).toEqual([]);
  });
});
