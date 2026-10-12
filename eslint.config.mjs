import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".open-next/**", ".wrangler/**", "out/**", "node_modules/**", ".worktrees/**"]),

  /*
   * Type-aware rules.
   *
   * Every mutation in this app is an async server action. A dropped `await`
   * does not throw — the write is simply abandoned when the request ends, and
   * the UI reports success. `no-floating-promises` is the only thing that
   * catches that, and it needs type information, hence the `project` list
   * below (both tsconfigs, so `tests/` is covered too).
   *
   * Cost: linting goes from roughly a second to roughly 45s, because ESLint
   * now builds a TypeScript program. That is fine for CI and for a pre-commit
   * run; use `eslint <path>` while iterating if it gets in the way.
   *
   * Deliberately NOT enabled: `require-await`. It fires on legitimate stubs
   * (`lib/notify.ts`) and on async config hooks, and it catches nothing that
   * loses data.
   */
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    ignores: ["tests/**"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // `checksVoidReturn.attributes` off: passing an async handler to a JSX
      // prop (onClick, form action) is the normal React pattern here.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  // `tests/` is excluded from the root tsconfig, so the project service cannot
  // find it. Point it at the test project explicitly.
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
]);
