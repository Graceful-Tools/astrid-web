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
import { existsSync } from "node:fs"
import { join } from "node:path"

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
  // directory names exempted anywhere in the tree
  excludeDirs?: string[]
  // optional ERE applied to whole grep output lines; matches are dropped
  reject?: string
  /**
   * Reported but never blocking, even under --strict.
   *
   * For a backlog too large to clear in one change: the rule goes in first so
   * new violations are visible from the day it lands, and flips to blocking
   * when the existing debt is gone. A rule that blocks on arrival just gets
   * --no-verify'd around, and then nobody reads it.
   */
  warnOnly?: boolean
}

/**
 * Every source root the running app is built from.
 *
 * Rules used to scan components/hooks/app/lib only, so mcp/, services/,
 * packages/, middleware.ts and instrumentation.ts were invisible and the gate
 * was green while leaks sat in them (task bc27c00a).
 * docs/WHITELABELING.md:288: a gate that is green for the wrong reason is worse
 * than no gate.
 *
 * scripts/, tests/ and tools/ are deliberately absent — they are reported
 * separately and never block, since a one-off migration script hardcoding a
 * colour is not the same defect as a component doing it.
 */
const ALL_ROOTS = [
  "components",
  "hooks",
  "app",
  "lib",
  "contexts",
  "mcp",
  "services",
  "packages",
  "pages",
  "types",
  "styles",
  "middleware.ts",
  "instrumentation.ts",
]

/** Roots that render UI. A JSX rule has nothing to say about mcp/ or prisma/. */
const UI_ROOTS = ["components", "hooks", "app", "contexts", "pages"]

const RULES: Rule[] = [
  {
    id: "inline-admin-check",
    description: "Inline admin check (list.admins.some(...))",
    fix: "Use lib/list-permissions.ts / lib/list-member-utils.ts (isListAdminOrOwner, canUserManageList) or a canEdit* value already in scope.",
    pattern: String.raw`admins(\?)?\.some\(`,
    globs: UI_ROOTS,
    exclude: [],
  },
  {
    id: "inline-owner-check",
    description: "Inline owner check (list.ownerId === user.id)",
    fix: "Use lib/list-permissions.ts / lib/list-member-utils.ts or a canEdit* value already in scope.",
    pattern: String.raw`ownerId[[:space:]]*===|===[[:space:]]*[A-Za-z0-9_.?]*\.ownerId`,
    globs: UI_ROOTS,
    exclude: [],
  },
  {
    id: "hardcoded-add-task-copy",
    description: "Hardcoded add-task placeholder/copy",
    fix: "Use an i18n key (e.g. t('tasks.addTaskPlaceholder')) from lib/i18n/locales/*.json.",
    pattern: String.raw`(placeholder|Text)[[:space:]]*[:=].{0,20}[Aa]dd (a )?task|Quick add`,
    globs: UI_ROOTS,
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
    //
    // Also brand-named ASSET paths ("/images/astrid-character.png"). Those slipped
    // through the first pass: lowercase and hyphenated, so neither of the patterns above
    // matched, and the Acme preview shipped an Astrid logo on its sign-in page.
    // Also the lowercase wordmark as JSX text (`>astrid<`) and slogan copy. The main
    // pattern is case-sensitive on purpose — otherwise AstridEmptyState, astridPhrase
    // and the astrid-signed wire value would all trip it — which is exactly why
    // `<h1>astrid</h1>` survived every earlier sweep and shipped on the Acme sign-in
    // page. Matching it as a standalone JSX text node keeps identifiers exempt.
    pattern: String.raw`\bAstrid\b|astrid\.cc|/[a-z/]*astrid-[a-z0-9-]*\.(png|jpg|jpeg|svg|webp|ico)|>[[:space:]]*astrid[[:space:]]*<|Get it done!`,
    globs: ALL_ROOTS,
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
    // Two separately PUBLISHED npm packages whose names, plugin ids and
    // documented identity are the brand: @gracefultools/astrid-sdk and the
    // openclaw-astrid-channel plugin. Renaming them breaks every consumer's
    // `npm install` and every OpenClaw gateway config that names the channel —
    // the same frozen-by-published-contract reasoning as `name_for_model` in
    // docs/WHITELABELING.md §7. Their BEHAVIOUR was de-branded in task
    // 979e1325 (base URLs and agent addresses follow the configured
    // deployment); it is only the package identity that is fixed.
    excludeDirs: ["astrid-sdk", "openclaw-astrid-channel"],
    // Comments are internal prose, deliberately left alone — renaming them is churn
    // with no whitelabel benefit. Covers //, /* */, and JSX {/* */}.
    // Comments are internal prose. Also dropped: lines naming the FROZEN wire
    // values (`X-Astrid-*` headers, the `astrid_` token prefix), which
    // subscribers and stored tokens match on by exact string — WHITELABELING §7.
    reject: String.raw`:[0-9]+:[[:space:]]*(//|\*|/\*|\{/\*)|X-Astrid-|astrid_`,
  },
  {
    id: "hardcoded-jsx-copy",
    description: "User-visible string written inline in JSX instead of an i18n key",
    fix: "Use an i18n key: const t = useTranslations('…') and t('someKey'), with the string added to lib/i18n/locales/*.json (all locales — npm run check:i18n enforces parity).",
    // Two shapes, both of which reach the user's eyes:
    //   1. a literal placeholder / title / aria-label prop
    //   2. a JSX text node of two or more words starting with a capital
    // Translated copy comes through {t('…')}, so it is a brace expression and
    // matches neither.
    pattern: String.raw`(placeholder|aria-label|title)="[A-Za-z][^"{}]{4,}"|>[[:space:]]*[A-Z][a-z]+[[:space:]]+[A-Za-z][[:space:]a-zA-Z]*[[:space:]]*<`,
    globs: UI_ROOTS,
    exclude: [],
    // Comments, and imports/paths that merely contain a quoted word.
    reject: String.raw`:[0-9]+:[[:space:]]*(//|\*|/\*|\{/\*)|import[[:space:]]`,
    // WARN ONLY. ~200 literals predate this rule (task d818849d); converting
    // them all is a mechanical sweep of its own, and each converted string
    // needs eleven translations. Blocking today would only teach people to
    // skip the gate.
    warnOnly: true,
  },
  {
    id: "hardcoded-hex-colour",
    description: "Hardcoded hex colour outside the brand colour modules",
    fix: "Import from lib/brand/colors.ts — DEFAULT_LIST_COLOR, LIST_COLOR_PALETTE, CHART_SERIES_COLORS, DANGER_COLOR — or BRAND.accentColor. Stylesheets read var(--brand-accent), published by the layout.",
    // Six-digit hex only. Three-digit (#fff) and the neutral greys that make up
    // most of the design system are left alone; this is about BRAND colour
    // leaking, not about banning colour literals. Task 518ec534 cleared the
    // tree of #3b82f6; this keeps it clear.
    pattern: String.raw`#3[bB]82[fF]6`,
    globs: [...ALL_ROOTS, "prisma"],
    // The two files that are ALLOWED to name a colour.
    exclude: ["config.ts", "colors.ts"],
    reject: String.raw`:[0-9]+:[[:space:]]*(//|\*|/\*|\{/\*)`,
  },
  {
    id: "hardcoded-identity",
    description: "Hardcoded personal address or production UUID in runtime code",
    fix: "Read it from the environment (see lib/admin-auth.ts, which was fixed this way in task 7610dd07) or from lib/brand/config.ts. A partner's deployment must not carry someone else's address or board id.",
    // Consumer mail domains and bare UUIDs. A UUID in runtime source is almost
    // always a production row id that a fork inherits and cannot change.
    pattern: String.raw`[A-Za-z0-9._%+-]+@(gmail|googlemail|outlook|hotmail|yahoo|icloud|me)\.com|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`,
    globs: ALL_ROOTS,
    // The one canonical home for a default board id. FIXALL_CLAIM_BOARD_IDS is
    // a security allowlist that is now env-configurable; the literals there are
    // its documented fallback, kept because failing closed on a deploy-time env
    // var would silently stop every agent claiming work.
    exclude: ["fixall-claim.ts"],
    // Comments (including the ones documenting why an id is what it is), and
    // the UUID-shaped strings in type/format documentation.
    reject: String.raw`:[0-9]+:[[:space:]]*(//|\*|/\*|\{/\*)`,
  },
  {
    id: "direct-prisma-client",
    description: "new PrismaClient() outside lib/prisma.ts",
    fix: "Import { prisma } from '@/lib/prisma'. A second client opens its own connection pool and bypasses the middleware registered there — including the AI-agent workflow hooks.",
    pattern: String.raw`new PrismaClient\(`,
    globs: ALL_ROOTS,
    exclude: ["prisma.ts"],
    reject: String.raw`:[0-9]+:[[:space:]]*(//|\*|/\*|\{/\*)`,
  },
]

const strict = process.argv.includes("--strict") || process.env.CHECK_REUSE_STRICT === "1"
const json = process.argv.includes("--json")

/**
 * Directory to scan. Defaults to the repo, but a test points it at a fixture
 * tree with deliberately planted violations — the only way to prove a rule
 * FIRES. A green run over a clean repo proves nothing: this script once had a
 * rule whose pattern contained a double quote, which ended the shell argument
 * early and matched nothing, reporting a confident zero (task d818849d).
 */
const rootIndex = process.argv.indexOf("--root")
const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd()

function search(rule: Rule): string[] {
  // Only scan globs that exist — the roots differ between the repo and a
  // fixture tree, and grep exits non-zero on a missing path.
  const present = rule.globs.filter((g) => existsSync(join(root, g)))
  if (present.length === 0) return []
  const dirs = present.map((g) => `'${g}'`).join(" ")
  const excludeArgs = [
    ...rule.exclude.map((e) => `--exclude='${e}'`),
    ...(rule.excludeDirs ?? []).map((d) => `--exclude-dir='${d}'`),
  ].join(" ")
  // POSIX grep (always on PATH, unlike rg). -r recursive, -E ERE, -n line #s.
  // Drop lines the rule considers out of scope (e.g. comments) before counting.
  // Patterns are SINGLE-quoted for the shell: hardcoded-jsx-copy has to match a
  // literal double quote (placeholder="…"), and inside double quotes that ended
  // the argument early and silently matched nothing — a rule reporting a
  // confident zero. No pattern here contains a single quote.
  const rejectFilter = rule.reject ? ` | grep -Ev '${rule.reject}'` : ""
  const cmd = `{ grep -rEn --include='*.ts' --include='*.tsx' --exclude='*.test.*' --exclude='*.spec.*' ${excludeArgs} -e '${rule.pattern}' ${dirs}${rejectFilter} ; } || true`
  try {
    const out = execSync(cmd, { encoding: "utf8", cwd: root })
    return out.split("\n").filter(Boolean)
  } catch {
    return []
  }
}

let total = 0
let advisory = 0
const findings: Record<string, string[]> = {}
if (!json) console.log("\n🔁 check:reuse — reuse-first backlog (docs/CODE_REUSE_AND_CONSISTENCY.md)\n")

for (const rule of RULES) {
  const hits = search(rule)
  findings[rule.id] = hits
  if (rule.warnOnly) advisory += hits.length
  else total += hits.length
  if (json) continue
  const badge = hits.length === 0 ? "✅" : rule.warnOnly ? "📋" : "⚠️ "
  const suffix = rule.warnOnly ? " (advisory — not blocking)" : ""
  console.log(`${badge} [${rule.id}] ${rule.description}: ${hits.length}${suffix}`)
  if (hits.length > 0) {
    console.log(`     fix: ${rule.fix}`)
    for (const h of hits.slice(0, 8)) console.log(`       ${h}`)
    if (hits.length > 8) console.log(`       … and ${hits.length - 8} more`)
  }
  console.log("")
}

if (json) {
  console.log(JSON.stringify({ version: 1, findings }, null, 2))
  process.exit(total === 0 || !strict ? 0 : 1)
}

// Non-source roots, reported separately and never blocking. A one-off
// migration script hardcoding a colour is not the same defect as a component
// doing it, but it is still worth being able to see. Task bc27c00a asked for
// these to be a separate, non-strict report rather than folded into the gate.
const SUPPORT_ROOTS = ["scripts", "tools"]
let support = 0
for (const rule of RULES) {
  if (rule.warnOnly) continue
  // check-reuse.ts contains every pattern by definition; it is not a violation.
  const hits = search({
    ...rule,
    globs: SUPPORT_ROOTS,
    exclude: [...rule.exclude, "check-reuse.ts"],
  })
  if (hits.length === 0) continue
  if (support === 0) console.log("── support code (scripts/, tools/) — reported, never blocking ──")
  support += hits.length
  console.log(`📋 [${rule.id}] ${hits.length}`)
  for (const h of hits.slice(0, 5)) console.log(`       ${h}`)
  if (hits.length > 5) console.log(`       … and ${hits.length - 5} more`)
}
if (support > 0) console.log("")

console.log("──────────────────────────────────────────")
if (advisory > 0) {
  console.log(`📋 ${advisory} advisory finding(s) — reported, not blocking.`)
}
if (total === 0) {
  console.log("✅ No blocking reuse-first violations found.")
  process.exit(0)
}
console.log(`⚠️  ${total} reuse-first violation(s) — WARN mode (not blocking).`)
console.log("   Flip a category to blocking with --strict once its backlog is cleared.")
process.exit(strict ? 1 : 0)
