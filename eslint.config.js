import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

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
  "/^(amount|balance|price|total|sum|rate)s?$|[a-z0-9](Amount|Balance|Price|Total|Sum|Rate)s?$/";
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

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "docs/**",
      "tools/**",
      "design/**",
      ".claude/**",
      ".github/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js}"],
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
    // Tests may use literals freely (they assert the rules above), and translation catalogues hold words.
    files: ["**/*.test.{ts,tsx}", "packages/i18n/src/messages/**", "**/test/fixtures/**"],
    rules: { "no-restricted-syntax": "off" },
  },
);
