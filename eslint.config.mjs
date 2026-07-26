import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      "**/*.d.ts",
      ".next/**",
      "dist/**",
      "docs/**",
      "astrid-mcp/**",
      "backups/**",
      "metrics/**",
      "playwright-report/**",
      "coverage/**",
      "public/**"
    ]
  },
  ...compat.extends("next/core-web-vitals"),
  {
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    languageOptions: {
      parser: tsParser
    },
    rules: {
      "@next/next/no-img-element": "off",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  // Reuse-first guardrails — see docs/CODE_REUSE_AND_CONSISTENCY.md.
  // WARN during Phase 0 rollout (report the backlog without breaking the build);
  // flip individual rules to "error" as each backlog is cleared (Phase 1+).
  // The canonical homes for these patterns are exempted below.
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: [
      // Permission logic legitimately lives in these modules.
      "lib/list-permissions.ts",
      "lib/list-member-utils.ts",
      "lib/list-member-operations.ts",
      "lib/task-manager-utils.ts",
      "lib/admin-access.ts",
      "lib/chat-access.ts",
      "lib/chat-channel-eligibility.ts",
      "lib/public-list-utils.ts",
      // Tests assert against these patterns intentionally.
      "tests/**",
      "e2e/**",
      // Diagnostic scripts print ownership for humans; they make no access
      // decisions, so the permission selectors do not apply.
      "scripts/**"
    ],
    rules: {
      "no-restricted-syntax": ["error",
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='some'][callee.object.property.name='admins']",
          message: "Don't inline an admin check (list.admins.some(...)). Use a helper from lib/list-permissions.ts / lib/list-member-utils.ts (e.g. isListAdminOrOwner, canUserManageList), or a canEdit* prop already in scope. See docs/CODE_REUSE_AND_CONSISTENCY.md."
        },
        {
          selector: "BinaryExpression[operator=/^===?$/][left.type='MemberExpression'][left.property.name='ownerId']",
          message: "Don't inline an owner check (list.ownerId === user.id). Use a helper from lib/list-permissions.ts / lib/list-member-utils.ts, or a canEdit* prop already in scope. See docs/CODE_REUSE_AND_CONSISTENCY.md."
        },
        {
          selector: "BinaryExpression[operator=/^===?$/][right.type='MemberExpression'][right.property.name='ownerId']",
          message: "Don't inline an owner check (user.id === list.ownerId). Use a helper from lib/list-permissions.ts / lib/list-member-utils.ts, or a canEdit* prop already in scope. See docs/CODE_REUSE_AND_CONSISTENCY.md."
        },
        {
          selector: "JSXAttribute[name.name='placeholder'] > Literal[value=/[Aa]dd (a )?task|[Qq]uick add/]",
          message: "Don't hardcode add-task copy. Use an i18n key (e.g. t('tasks.addTaskPlaceholder')). See docs/CODE_REUSE_AND_CONSISTENCY.md."
        },
        {
          selector: "Property[key.name='placeholder'] > Literal[value=/[Aa]dd (a )?task|[Qq]uick add/]",
          message: "Don't hardcode add-task copy. Use an i18n key (e.g. t('tasks.addTaskPlaceholder')). See docs/CODE_REUSE_AND_CONSISTENCY.md."
        }
      ]
    }
  }
];

export default eslintConfig;
