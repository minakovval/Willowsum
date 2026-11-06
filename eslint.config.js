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
const AMOUNT_NAME =
  "/^(amount|balance|price|total|sum|rate|value)s?$|Amount$|Balance$|Price$|Total$|Sum$|Rate$/i";
const NO_FLOAT_MONEY = [
  {
    selector:
      "CallExpression[callee.name='parseFloat'], CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
    message:
      "parseFloat is not allowed: amounts are Decimal (packages/domain-kernel), never floats (NFR-06).",
  },
  {
    selector: "NewExpression[callee.name='Decimal'][arguments.0.type='Literal'][arguments.0.raw=/^-?[0-9.]/]",
    message: "Create a Decimal from a decimal string, not from a JS number (NFR-06).",
  },
  {
    selector:
      "CallExpression[callee.object.name='Money'][callee.property.name='of'][arguments.0.raw=/^-?[0-9.]/]",
    message: "Money.of takes a decimal string, not a JS number (NFR-06).",
  },
  {
    selector: `:matches(TSPropertySignature, PropertyDefinition)[key.name=${AMOUNT_NAME}] > TSTypeAnnotation > TSNumberKeyword`,
    message: "An amount, balance, price, total or rate is a Decimal or Money, not number (NFR-06).",
  },
  {
    selector: `Identifier[name=${AMOUNT_NAME}] > TSTypeAnnotation > TSNumberKeyword`,
    message: "An amount, balance, price, total or rate is a Decimal or Money, not number (NFR-06).",
  },
];

/** NFR-06 FR 8 / AGENTS.md «Plans»: no plan names in code; plans are checked through the entitlement interface. */
const NO_PLAN_NAMES = [
  {
    // Icon names («plus») in JSX attributes and literal types are not plans.
    selector:
      "Literal[value=/^(free|plus|family|trial)$/i]:not(JSXAttribute > Literal):not(TSLiteralType > Literal)",
    message:
      "No plan names in code: check entitlements with the requirement's feature key (NFR-06, AGENTS.md «Plans»).",
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
