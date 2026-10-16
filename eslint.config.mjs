import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", "src/generated/**", "coverage/**", "next-env.d.ts"]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  // Only the platform database module imports the generated Prisma client.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/platform/db.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/generated/*", "@/generated/**"], message: "Use @/platform/db (and Tx from @/platform/tenant)." }] },
      ],
    },
  },
  // Module boundaries: other code imports a module only through its public index.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/modules/**", "src/platform/db.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/modules/*/*"], message: "Import a module through its public index (@/modules/<name>)." },
            { group: ["@/generated/*", "@/generated/**"], message: "Use @/platform/db (and Tx from @/platform/tenant)." },
          ],
        },
      ],
    },
  },
  // Pure domain code: no database, framework or floating-point money.
  {
    files: ["src/modules/*/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/platform/*", "@/generated/*", "next", "next/*", "react"], message: "Domain code stays pure (no I/O, no framework)." },
          ],
        },
      ],
      "no-restricted-globals": ["error", { name: "parseFloat", message: "Money and quantities never use floats." }],
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: "Money and quantities never use floats." },
        { object: "Math", property: "round", message: "Use the central rounding function." },
      ],
    },
  },
]);
