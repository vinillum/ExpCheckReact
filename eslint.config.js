import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

// Run with `npm run lint`. ESLint is on version 9 because eslint-plugin-react does
// not support 10 yet; move up when its peer range allows it.
export default [
  { ignores: ["build/", "coverage/", "node_modules/"] },

  js.configs.recommended,
  react.configs.flat.recommended,
  reactHooks.configs.flat.recommended,

  { settings: { react: { version: "detect" } } },

  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: { globals: globals.browser },
    rules: {
      // The components take plain props and the project has no PropTypes.
      "react/prop-types": "off",
      // `catch (e)` with e unused is fine here (ESLint 8 and Create React App did not
      // flag it; ESLint 9 does by default).
      "no-unused-vars": ["error", { caughtErrors: "none" }],
      // The app must never emit a javascript: URL (see the result links tests).
      "no-script-url": "error",
    },
  },

  // Tests run in jsdom under Node, with Vitest's globals (see vite.config.js).
  {
    files: ["src/**/*.test.js", "src/testHelpers.js"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
  },

  // Config files run in Node.
  {
    files: ["*.config.js"],
    languageOptions: { globals: globals.node },
  },
];
