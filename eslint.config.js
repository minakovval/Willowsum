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

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "docs/**",
      "tools/**",
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
      "no-restricted-syntax": ["error", NO_COLOR_LITERALS, NO_COLOR_TEMPLATES],
    },
  },
  {
    files: ["packages/ui/src/tokens/**", "**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
);
