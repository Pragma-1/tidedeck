// Type-aware lint, run by `npm run check`. Its main job: async functions must be awaited.
// After the move to PostgreSQL almost every data function returns a Promise — and a Promise in an
// `if` is always truthy, so a forgotten `await` on e.g. a rate-limit check would silently disable
// it. These rules make that a build failure.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "tests/**", "scripts/**", "*.cjs", "*.mjs", "next-env.d.ts"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "off",
    },
  },
);
