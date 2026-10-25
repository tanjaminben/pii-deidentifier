import reactHooks from "eslint-plugin-react-hooks";

// The only lint rules the Create React App build enforced (through craco's eslint block) were
// the React hooks rules, with rules-of-hooks as a hard error that failed the build. Vite does
// not lint while it builds, so this keeps that guardrail as an explicit `npm run lint`, which
// Redactorium CI runs before the build.
export default [
  { ignores: ["build/**", "node_modules/**"] },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
