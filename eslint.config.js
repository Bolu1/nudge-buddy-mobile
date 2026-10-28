// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "ios/*", "android/*"],
  },
  {
    rules: {
      // Screens load their data in an effect on mount (fetch → setState), the
      // same pattern as the web app. The React Compiler rule flags it; keep it
      // visible as a warning rather than an error until data loading moves to
      // a fetching library.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);
