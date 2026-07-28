#!/usr/bin/env tsx
/**
 * check:reuse — reuse-first backlog reporter.
 *
 * Reports where the codebase inlines logic that has a canonical home, so drift
 * is visible instead of silent. See docs/CODE_REUSE_AND_CONSISTENCY.md.
 *
 * The backlog is CLEARED (task e2803305 / 5fac84e8): `npm run check:reuse` now
 * runs --strict and exits non-zero on any violation, and the ESLint
 * no-restricted-syntax rules are at "error". Use `npm run check:reuse:warn` for
 * the old non-blocking view. Historical note: this began as WARN mode while the
 * backlog was worked down; --strict was wired in per-category as each backlog is
 * cleared (Phase 1+).
 *
 * The authoritative machine-enforced version is the ESLint `no-restricted-syntax`
 * block in eslint.config.mjs; this script is the human-readable rollup.
 */
import { execSync } from "node:child_process"

interface Rule {
  id: string
  description: string
  fix: string
  // grep ERE pattern
  pattern: string
  // directories to search
  globs: string[]
  // basenames exempted (canonical homes)
  exclude: string[]
  // optional ERE applied to whole grep output lines; matches are dropped
  reject?: string
}

const RULES: Rule[] = [
  {
    id: "inline-admin-check",
    description: "Inline admin check (list.admins.some(...))",
    fix: "Use lib/list-permissions.ts / lib/list-member-utils.ts (isListAdminOrOwner, canUserManageList) or a canEdit* value already in scope.",
    pattern: String.raw`admins(\?)?\.some\(`,
    globs: ["components", "hooks", "app"],
    exclude: [],
  },
  {
    id: "inline-owner-check",
    description: "Inline owner check (list.ownerId === user.id)",
    fix: "Use lib/list-permissions.ts / lib/list-member-utils.ts or a canEdit* value already in scope.",
    pattern: String.raw`ownerId[[:space:]]*===|===[[:space:]]*[A-Za-z0-9_.?]*\.ownerId`,
    globs: ["components", "hooks", "app"],
    exclude: [],
  },
  {
    id: "hardcoded-add-task-copy",
    description: "Hardcoded add-task placeholder/copy",
    fix: "Use an i18n key (e.g. t('tasks.addTaskPlaceholder')) from lib/i18n/locales/*.json.",
    pattern: String.raw`(placeholder|Text)[[:space:]]*[:=].{0,20}[Aa]dd (a )?task|Quick add`,
    globs: ["components", "app"],
    // No exemptions: every add-task input now reads its placeholder from
    // tasks.addTaskPlaceholder / tasks.addTaskToList (task 5fac84e8).
    // quick-task-create.tsx was dead code and has been deleted.
    exclude: [],
  },
  {
    id: "hardcoded-brand-literal",
    description: "Hardcoded brand literal (\"Astrid\" / astrid.cc) in UI code",
    fix: "Use lib/brand/config.ts — BRAND.appName, BRAND.domain, BRAND.agentEmailDomain, BRAND.supportEmail, BRAND.inboundTaskEmail — or an i18n key with an {appName} token.",
    // Word-boundary "Astrid" so identifiers (AstridEmptyState, astridPhrase) and the
    // `astrid-signed` wire value are not flagged; plus the bare domain. Task 97208a72.
    pattern: String.raw`\bAstrid\b|astrid\.cc`,
    globs: ["components", "app", "hooks", "lib"],
    // Canonical homes and frozen wire values only:
    //   config.ts / capabilities.ts / agent-emails.ts — where the brand is defined
    //   i18n-values.ts                                — documents the message tokens
    //   protocol-headers.ts / webhook-signature.ts    — published header names that
    //     subscribers verify by exact string; renaming them breaks live integrations
    //   apple-identity.ts                             — Apple bundle identifiers
    exclude: [
      "config.ts",
      "capabilities.ts",
      "agent-emails.ts",
      "i18n-values.ts",
      "protocol-headers.ts",
      "webhook-signature.ts",
      "apple-identity.ts",
    ],
    // Comments are internal prose, deliberately left alone — renaming them is churn
    // with no whitelabel benefit. Covers //, /* */, and JSX {/* */}.
    reject: String.raw`:[0-9]+:[[:space:]]*(//|\*|/\*|\{/\*)`,
  },
]

const strict = process.argv.includes("--strict") || process.env.CHECK_REUSE_STRICT === "1"

function search(rule: Rule): string[] {
  const dirs = rule.globs.map((g) => `'${g}'`).join(" ")
  const excludeArgs = rule.exclude.map((e) => `--exclude='${e}'`).join(" ")
  // POSIX grep (always on PATH, unlike rg). -r recursive, -E ERE, -n line #s.
  // Drop lines the rule considers out of scope (e.g. comments) before counting.
  const rejectFilter = rule.reject ? ` | grep -Ev "${rule.reject}"` : ""
  const cmd = `{ grep -rEn --include='*.ts' --include='*.tsx' --exclude='*.test.*' --exclude='*.spec.*' ${excludeArgs} -e "${rule.pattern}" ${dirs}${rejectFilter} ; } || true`
  try {
    const out = execSync(cmd, { encoding: "utf8", cwd: process.cwd() })
    return out.split("\n").filter(Boolean)
  } catch {
    return []
  }
}

let total = 0
console.log("\n🔁 check:reuse — reuse-first backlog (docs/CODE_REUSE_AND_CONSISTENCY.md)\n")

for (const rule of RULES) {
  const hits = search(rule)
  total += hits.length
  const badge = hits.length === 0 ? "✅" : "⚠️ "
  console.log(`${badge} [${rule.id}] ${rule.description}: ${hits.length}`)
  if (hits.length > 0) {
    console.log(`     fix: ${rule.fix}`)
    for (const h of hits.slice(0, 8)) console.log(`       ${h}`)
    if (hits.length > 8) console.log(`       … and ${hits.length - 8} more`)
  }
  console.log("")
}

console.log("──────────────────────────────────────────")
if (total === 0) {
  console.log("✅ No reuse-first violations found.")
  process.exit(0)
}
console.log(`⚠️  ${total} reuse-first violation(s) — WARN mode (not blocking).`)
console.log("   Flip a category to blocking with --strict once its backlog is cleared.")
process.exit(strict ? 1 : 0)
