import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { readFileSync } from "node:fs";

/** DS-06 acceptance 3 / DS-09 acceptance 7: colour literals live only in the token sources. */
const NO_COLOR_LITERALS = {
  selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b|\\b(rgb|rgba|hsl|hsla)\\(/]",
  message: "Colour literals are allowed only in packages/ui/src/tokens. Use a token (var(--ws-…)).",
};
const NO_COLOR_TEMPLATES = {
  selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\b(rgb|rgba|hsl|hsla)\\(/]",
  message: "Colour literals are allowed only in packages/ui/src/tokens. Use a token (var(--ws-…)).",
};

/** NFR-06 FR 1 / AGENTS.md «Money»: no floats for amounts (static analysis). */
// Exact lower-case names, or a camelCase suffix (`totalAmount`, `unitPrice`); `checksum` and `separate` are not amounts.
const AMOUNT_NAME =
  "/^(amount|balance|price|total|subtotal|sum|rate)s?$|[a-z0-9](Amount|Balance|Price|Total|Sum|Rate)s?$/";
const NUMERIC_ARG = (fn) =>
  `${fn}:matches([arguments.0.type='Literal'][arguments.0.raw=/^[0-9.]/], [arguments.0.type='UnaryExpression'][arguments.0.argument.type='Literal'])`;
const AMOUNT_NUMBER_TYPE =
  "An amount, balance, price, total or rate is a Decimal or Money, not number (NFR-06).";
const NO_FLOAT_MONEY = [
  {
    selector:
      "CallExpression[callee.name='parseFloat'], CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
    message:
      "parseFloat is not allowed: amounts are Decimal (packages/domain-kernel), never floats (NFR-06).",
  },
  {
    selector: `${NUMERIC_ARG("NewExpression[callee.name='Decimal']")}, ${NUMERIC_ARG("CallExpression[callee.name='Decimal']")}`,
    message: "Create a Decimal from a decimal string, not from a JS number (NFR-06).",
  },
  {
    selector: NUMERIC_ARG("CallExpression[callee.object.name='Money'][callee.property.name='of']"),
    message: "Money.of takes a decimal string, not a JS number (NFR-06).",
  },
  {
    selector: "CallExpression[callee.property.name='toNumber']",
    message: "toNumber() turns an amount into a float; keep Decimal or Money (NFR-06).",
  },
  {
    selector: `CallExpression[callee.name='Number']:matches([arguments.0.name=${AMOUNT_NAME}], [arguments.0.property.name=${AMOUNT_NAME}])`,
    message: "Number(amount) turns an amount into a float; keep Decimal or Money (NFR-06).",
  },
  {
    // Any `number` inside the annotation: plain, union with null/undefined, arrays.
    selector: `:matches(TSPropertySignature, PropertyDefinition)[key.name=${AMOUNT_NAME}] > TSTypeAnnotation TSNumberKeyword`,
    message: AMOUNT_NUMBER_TYPE,
  },
  {
    selector: `Identifier[name=${AMOUNT_NAME}] > TSTypeAnnotation TSNumberKeyword`,
    message: AMOUNT_NUMBER_TYPE,
  },
];

/** NFR-06 FR 8 / AGENTS.md «Plans»: no plan names in code; plans are checked through the entitlement interface. */
const PLAN_NAME = "/^(free|plus|family|trial)$/i";
const PLAN_MESSAGE =
  "No plan names in code: check entitlements with the requirement's feature key (NFR-06, AGENTS.md «Plans»).";
const NO_PLAN_NAMES = [
  {
    // The only exemption: an icon name, e.g. <Icon name="plus" /> (the icon registry has its own override).
    selector: `Literal[value=${PLAN_NAME}]:not(JSXAttribute[name.name='name'] > Literal)`,
    message: PLAN_MESSAGE,
  },
  {
    selector: `TemplateLiteral[expressions.length=0] > TemplateElement[value.raw=${PLAN_NAME}]`,
    message: PLAN_MESSAGE,
  },
];

const OPENAPI_CLIENT_PATHS = [
  { name: "openapi-fetch", message: "Use @willowsum/api-contract (ARC-07, ADR-0003)." },
  { name: "openapi-typescript", message: "Only packages/api-contract generates the client (ADR-0003)." },
];

/** ARC-05 FR 1: provider SDKs (apps/api/provider-sdks.json) only in adapter folders (ADR-0005). */
const PROVIDER_SDKS = JSON.parse(
  readFileSync(new URL("./apps/api/provider-sdks.json", import.meta.url), "utf8"),
);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PROVIDER_SDK_PATTERNS = PROVIDER_SDKS.packages.map((name) => ({
  regex: `^${name.endsWith("/*") ? `${escapeRe(name.slice(0, -2))}/[^/]+` : escapeRe(name)}(/.*)?$`,
  message:
    "A provider SDK is used only inside an adapter (ARC-05, ADR-0005): put this import in an adapters/ folder.",
}));
const PROVIDER_SDK_RES = PROVIDER_SDK_PATTERNS.map((p) => new RegExp(p.regex));
const PROVIDER_SDK_MESSAGE =
  PROVIDER_SDK_PATTERNS[0]?.message ?? "A provider SDK is used only inside an adapter.";
/**
 * NFR-09@PoC FR 1 (criterion «i18n»), П-15: no hard-coded strings in the interface. Text the user reads or
 * hears comes from the translation catalogue (`@willowsum/i18n`). Reported: JSX text with a letter; a string
 * literal or template with a letter shown as a JSX child (also behind `?:`, `&&`, `||`, `??`) or given to an
 * attribute the user reads or hears; a literal message of alert, confirm or prompt. Digits, symbols and
 * punctuation are allowed. apps/web/src/i18n/noHardcodedStrings.test.ts checks this rule and that it applies
 * to every interface file (fails closed).
 */
const LETTER = /\p{L}/u;
const UI_TEXT_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "placeholder",
  "alt",
  "label",
]);
const UI_DIALOGS = new Set(["alert", "confirm", "prompt"]);
const HARDCODED_MESSAGE =
  "Hard-coded interface text: put it in the translation catalogue (packages/i18n) and use t() (NFR-09 FR 1, П-15).";
const literalText = (node) =>
  node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node.type === "TemplateLiteral"
      ? node.quasis.map((q) => q.value.cooked ?? "").join("")
      : null;
/** Skips the conditional and logical expressions a literal can sit in. */
const valueParent = (node) => {
  let p = node.parent;
  while (p && (p.type === "ConditionalExpression" || p.type === "LogicalExpression")) {
    if (p.type === "ConditionalExpression" && p.test === node) return null;
    node = p;
    p = p.parent;
  }
  return p;
};
const noHardcodedUiStrings = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const check = (node) => {
      const text = literalText(node);
      if (text === null || !LETTER.test(text)) return;
      let p = valueParent(node);
      if (p?.type === "JSXExpressionContainer") {
        if (p.parent.type === "JSXElement" || p.parent.type === "JSXFragment")
          return context.report({ node, message: HARDCODED_MESSAGE });
        p = p.parent;
      }
      if (p?.type === "JSXAttribute" && UI_TEXT_ATTRIBUTES.has(p.name.name))
        return context.report({ node, message: HARDCODED_MESSAGE });
      if (p?.type === "CallExpression" && p.arguments[0] === node) {
        const callee = p.callee;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" && callee.property.type === "Identifier"
              ? callee.property.name
              : null;
        const onWindow =
          callee.type === "Identifier" ||
          (callee.type === "MemberExpression" &&
            callee.object.type === "Identifier" &&
            callee.object.name === "window");
        if (name && onWindow && UI_DIALOGS.has(name)) context.report({ node, message: HARDCODED_MESSAGE });
      }
    };
    return {
      JSXText(node) {
        if (LETTER.test(node.value)) context.report({ node, message: HARDCODED_MESSAGE });
      },
      Literal: check,
      TemplateLiteral: check,
    };
  },
};
/**
 * The loading forms `no-restricted-imports` does not see: `import()`, `import("x").T`, `require()` and
 * `createRequire(…)()` (ARC-05 FR 1). The dependency analyzer (`pnpm check:modules`) checks the same in CI.
 */
const willowsumPlugin = {
  rules: {
    "no-hardcoded-ui-strings": noHardcodedUiStrings,
    "no-provider-sdk-load": {
      meta: { type: "problem", schema: [] },
      create(context) {
        const check = (node, source) => {
          const value =
            source?.type === "Literal"
              ? source.value
              : source?.type === "TSLiteralType"
                ? source.literal?.value
                : source?.type === "TemplateLiteral" && source.expressions.length === 0
                  ? source.quasis[0]?.value.cooked
                  : undefined;
          if (typeof value === "string" && PROVIDER_SDK_RES.some((re) => re.test(value)))
            context.report({ node, message: PROVIDER_SDK_MESSAGE });
        };
        return {
          ImportExpression: (node) => check(node, node.source),
          TSImportType: (node) => check(node, node.argument),
          TSExternalModuleReference: (node) => check(node, node.expression),
          CallExpression(node) {
            const callee = node.callee;
            const isRequire =
              (callee.type === "Identifier" && callee.name === "require") ||
              (callee.type === "MemberExpression" &&
                callee.object.type === "Identifier" &&
                callee.object.name === "require" &&
                callee.property.type === "Identifier" &&
                callee.property.name === "resolve");
            const isCreated =
              callee.type === "CallExpression" &&
              callee.callee.type === "Identifier" &&
              callee.callee.name === "createRequire";
            if (isRequire || isCreated) check(node, node.arguments[0]);
          },
        };
      },
    },
  },
};
/** Every source file kind ESLint checks. */
const ALL_FILES = ["**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"];
const ADAPTER_FILES = [
  "apps/api/src/modules/*/adapters/**",
  "apps/api/src/platform/adapters/**",
  "apps/web/src/adapters/**",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      // Build output of a package only: a dist/ folder inside src/ is still checked.
      "*/*/dist/**",
      "dist/**",
      "**/coverage/**",
      "docs/**",
      // tools/ holds scripts outside the workspace packages; tools/synthetic is a workspace package (linted).
      "tools/*",
      "!tools/synthetic",
      "design/**",
      ".claude/**",
      ".github/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ALL_FILES,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-syntax": [
        "error",
        NO_COLOR_LITERALS,
        NO_COLOR_TEMPLATES,
        ...NO_FLOAT_MONEY,
        ...NO_PLAN_NAMES,
      ],
    },
  },
  {
    // Token sources may hold colour literals, but the money and plan rules still apply.
    files: ["packages/ui/src/tokens/**"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", ...NO_FLOAT_MONEY, ...NO_PLAN_NAMES] },
  },
  {
    // The icon registry lists icon names («plus»), not plans.
    files: ["packages/ui/src/icons/Icon.tsx"],
    rules: { "no-restricted-syntax": ["error", NO_COLOR_LITERALS, NO_COLOR_TEMPLATES, ...NO_FLOAT_MONEY] },
  },
  {
    // ARC-07 / ADR-0003: the OpenAPI client libraries are used only inside packages/api-contract; every other
    // package talks to the API through @willowsum/api-contract. ARC-05 FR 1 / ADR-0005: provider SDKs only in
    // adapter folders, in every file kind and loading form (the dependency analyzer checks the same in CI).
    files: ALL_FILES,
    ignores: ["packages/api-contract/**", ...ADAPTER_FILES],
    plugins: { willowsum: willowsumPlugin },
    rules: {
      "no-restricted-imports": ["error", { paths: OPENAPI_CLIENT_PATHS, patterns: PROVIDER_SDK_PATTERNS }],
      "willowsum/no-provider-sdk-load": "error",
    },
  },
  {
    files: ADAPTER_FILES,
    rules: { "no-restricted-imports": ["error", { paths: OPENAPI_CLIENT_PATHS }] },
  },
  {
    files: ["packages/api-contract/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"],
    plugins: { willowsum: willowsumPlugin },
    rules: {
      "no-restricted-imports": ["error", { patterns: PROVIDER_SDK_PATTERNS }],
      "willowsum/no-provider-sdk-load": "error",
    },
  },
  {
    // Analyzer fixtures import provider SDKs on purpose (apps/api/scripts/lib/provider-sdks.test.ts).
    files: ["apps/api/test/fixtures/provider-sdks/**"],
    rules: { "no-restricted-imports": "off", "willowsum/no-provider-sdk-load": "off" },
  },
  {
    // NFR-09@PoC FR 1: interface text only from the translation catalogue (tests and test helpers excepted).
    files: ["apps/web/src/**/*.{ts,tsx}", "packages/ui/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "**/testing.tsx", "**/test-utils/**"],
    plugins: { willowsum: willowsumPlugin },
    rules: { "willowsum/no-hardcoded-ui-strings": "error" },
  },
  {
    // Tests may use literals freely (they assert the rules above), and translation catalogues hold words.
    files: ["**/*.test.{ts,tsx}", "packages/i18n/src/messages/**", "**/test/fixtures/**"],
    rules: { "no-restricted-syntax": "off" },
  },
);
