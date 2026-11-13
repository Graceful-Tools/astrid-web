#!/usr/bin/env tsx
/**
 * How much of the UI is written out by hand instead of asked of the design
 * system (docs/specs/DESIGN_SYSTEM.md) and the locale files.
 *
 *   npm run design:metrics              # print the counts
 *   npm run check:design                # fail if a count rose above its budget
 *   npm run design:metrics -- --update  # lower the budgets to today's counts
 *   npm run design:metrics -- --root <dir>   # count another checkout
 *
 * Every count is a number of places where a value that has a shared home was
 * typed instead: a colour, a size, a duration, a sentence. They only ever go
 * down. A change that needs one more is a change that should have used a token,
 * a theme class or an i18n key; `--update` never raises a budget, so raising
 * one is an edit to the JSON with its reason in the commit message.
 *
 * Totals per metric, not per file: the point is the direction, and a per-file
 * table for 1,600 palette classes would be edited by every pull request.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

export const BUDGET_FILE = 'tests/rules/design-metrics.budget.json'

const PALETTE =
  'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'

export interface Metric {
  id: string
  what: string
  /** Use this instead. */
  instead: string
  roots: string[]
  extensions: string[]
  pattern: RegExp
  /** Count distinct matches rather than every occurrence. */
  distinct?: boolean
  /** Paths (relative, forward slashes) left out of the count, each with why. */
  exempt?: Exemption[]
}

export interface Exemption {
  pattern: RegExp
  /** Why these files are not counted. A pattern with no reason is a budget raised quietly. */
  reason: string
}

const DESIGN_HOME: Exemption[] = [
  { pattern: /^lib\/(brand|design)\//, reason: 'the shared home of brand and design values' },
]

/**
 * Pages that keep their English on purpose (AWTD-1613, option 1 of the design audit's open
 * question; docs/specs/DESIGN_AUDIT_2026-11.md). Help is translated; these are not counted.
 */
export const COPY_EXEMPTIONS: Exemption[] = [
  {
    pattern: /^components\/legal\/(PrivacyPolicyContent|TermsOfServiceContent)\.tsx$/,
    reason: 'legal text stays in English: a machine translation of a privacy policy or terms is not something to publish',
  },
  {
    pattern: /^(app\/\[locale\]\/docs\/|components\/docs\/)/,
    reason: 'developer documentation is written in English for developers, like the API it describes',
  },
  {
    pattern:
      /^(app\/\[locale\]\/(admin|debug-reminders|debug-reminders-enhanced|test-time-picker)\/|components\/oauth-api-tester\.tsx$)/,
    reason: 'internal tools: admin, debugging and test pages that only the team opens',
  },
]

const UI = ['app', 'components', 'hooks', 'contexts']
const CODE = ['.ts', '.tsx']
/**
 * A sentence a person reads, typed into JSX: a literal placeholder, title or
 * aria-label, or a text node of two or more words starting with a capital.
 * Punctuation is part of a sentence ("Select an app to edit."); `{`, `=`, `&`
 * and `|` are not, which keeps expressions and comparisons out. An example URL
 * in a placeholder is not a sentence either: it reads the same in every language.
 */
const COPY = /(?:placeholder|aria-label|title)="(?!https?:\/\/)[A-Za-z][^"{}]{4,}"|>\s*[A-Z][a-z]+\s+[A-Za-z][\w\s.,!?'’"“”:;()\/%…–—-]*</g

/** The words themselves, so the same sentence in a text node and a placeholder is one string. */
function sentence(match: string): string {
  const attribute = /^(?:placeholder|aria-label|title)="([\s\S]*)"$/.exec(match)
  const text = attribute ? attribute[1] : match.replace(/^>/, '').replace(/<$/, '')
  return text.replace(/\s+/g, ' ').trim()
}

export const METRICS: Metric[] = [
  {
    id: 'rawPaletteClasses',
    what: 'Tailwind palette classes (text-gray-400, bg-blue-500, …)',
    instead: 'the theme vocabulary (text-theme-muted, bg-brand, text-danger …: docs/specs/DESIGN_SYSTEM.md → Palette classes to theme classes), or lib/design/priority.ts',
    roots: UI,
    extensions: CODE,
    pattern: new RegExp(`\\b[a-z-]+-(?:${PALETTE})-\\d{2,3}\\b`, 'g'),
  },
  {
    id: 'hexColours',
    what: 'hex colours in code and stylesheets',
    instead: 'a token; lib/brand/colors.ts for the list palette',
    roots: [...UI, 'lib', 'styles'],
    extensions: [...CODE, '.css'],
    pattern: /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
    exempt: DESIGN_HOME,
  },
  {
    id: 'rgbColours',
    what: 'rgb()/rgba() literals in code and stylesheets',
    instead: 'rgb(var(--astrid-*)) or rgb(var(--theme-*)); in a class, the theme vocabulary',
    roots: [...UI, 'lib', 'styles'],
    extensions: [...CODE, '.css'],
    pattern: /rgba?\(\s*\d/g,
    exempt: DESIGN_HOME,
  },
  {
    id: 'themeTriplets',
    what: 'r, g, b triplets written out in the theme stylesheets',
    instead: 'a token in astrid-core design/tokens.json (register DS9)',
    roots: ['styles/themes'],
    extensions: ['.css'],
    pattern: /--theme-[a-z0-9-]+:\s*\d+,\s*\d+,\s*\d+/g,
  },
  {
    id: 'inlineStyles',
    what: 'style={{ … }} props',
    instead: 'a class; a style prop is for values computed at run time',
    roots: UI,
    extensions: ['.tsx'],
    pattern: /style=\{\{/g,
  },
  {
    id: 'arbitrarySizes',
    what: 'Tailwind arbitrary sizes (w-[37px], text-[10px], …)',
    instead: 'the spacing, radius and type scales',
    roots: UI,
    extensions: CODE,
    pattern: /\[[0-9.]+(?:px|rem|em)\]/g,
  },
  {
    id: 'motionLiterals',
    what: 'durations written out (duration-200, 0.3s, 150ms)',
    instead: 'var(--astrid-motion-*) in CSS, duration-fast ease-fast and the like in a class (docs/specs/DESIGN_SYSTEM.md → Motion on web)',
    roots: [...UI, 'styles'],
    extensions: ['.tsx', '.css'],
    // duration-[var(--astrid-motion-…)] is the token, not a literal.
    pattern: /\bduration-(?:\d+|\[(?!var\()[^\]]+\])|(?<![\w.#-])\d*\.?\d+m?s\b(?=[\s;,)"'`])/g,
  },
  {
    id: 'hardcodedCopy',
    what: 'user-visible sentences typed into JSX (occurrences)',
    instead: "t('…') with the string in lib/i18n/locales/*.json",
    roots: ['app', 'components'],
    extensions: ['.tsx'],
    pattern: COPY,
    exempt: COPY_EXEMPTIONS,
  },
  {
    id: 'uniqueHardcodedStrings',
    what: 'distinct user-visible sentences typed into JSX',
    instead: "t('…'); a string used twice is one key",
    roots: ['app', 'components'],
    extensions: ['.tsx'],
    pattern: COPY,
    distinct: true,
    exempt: COPY_EXEMPTIONS,
  },
]

function files(root: string, directory: string, extensions: string[], out: string[] = []): string[] {
  let names: string[]
  try {
    names = readdirSync(join(root, directory))
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = `${directory}/${name}`
    if (statSync(join(root, path)).isDirectory()) files(root, path, extensions, out)
    else if (extensions.includes(extname(name)) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

/** Comments are prose about the code, not the code. */
export function withoutComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

export function isExempt(metric: Metric, path: string): boolean {
  return metric.exempt?.some(({ pattern }) => pattern.test(path)) ?? false
}

export function count(metric: Metric, sources: Array<{ path: string; source: string }>): number {
  const seen = new Set<string>()
  let total = 0
  for (const { path, source } of sources) {
    if (isExempt(metric, path)) continue
    const matches = withoutComments(source).match(metric.pattern) ?? []
    total += matches.length
    for (const match of matches) seen.add(metric.pattern === COPY ? sentence(match) : match.replace(/\s+/g, ' ').trim())
  }
  return metric.distinct ? seen.size : total
}

export function measure(root: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const metric of METRICS) {
    const sources = metric.roots.flatMap((directory) =>
      files(root, directory, metric.extensions).map((path) => ({
        path,
        source: readFileSync(join(root, path), 'utf8'),
      })),
    )
    counts[metric.id] = count(metric, sources)
  }
  return counts
}

export function overBudget(counts: Record<string, number>, budget: Record<string, number>): string[] {
  const problems: string[] = []
  for (const metric of METRICS) {
    const allowed = budget[metric.id]
    if (allowed === undefined) problems.push(`${metric.id} has no budget in ${BUDGET_FILE}`)
    else if (counts[metric.id] > allowed) {
      problems.push(
        `${metric.id}: ${counts[metric.id]} > ${allowed} — ${counts[metric.id] - allowed} new ${metric.what}. Use ${metric.instead}.`,
      )
    }
  }
  return problems
}

function main() {
  const args = process.argv.slice(2)
  const rootFlag = args.indexOf('--root')
  const root = rootFlag === -1 ? process.cwd() : args[rootFlag + 1]
  const counts = measure(root)

  if (args.includes('--json')) {
    console.log(JSON.stringify(counts, null, 2))
    return
  }

  const budgetPath = join(process.cwd(), BUDGET_FILE)
  let budget: Record<string, number> = {}
  try {
    budget = JSON.parse(readFileSync(budgetPath, 'utf8'))
  } catch {
    // First run: --update writes it.
  }

  if (args.includes('--update')) {
    const next: Record<string, number> = {}
    for (const metric of METRICS) {
      const allowed = budget[metric.id]
      next[metric.id] = allowed === undefined ? counts[metric.id] : Math.min(allowed, counts[metric.id])
    }
    writeFileSync(budgetPath, `${JSON.stringify(next, null, 2)}\n`)
    budget = next
    console.log(`Budgets in ${BUDGET_FILE} are today's counts wherever they fell.\n`)
  }

  const width = Math.max(...METRICS.map((metric) => metric.id.length))
  for (const metric of METRICS) {
    const allowed = budget[metric.id]
    const slack =
      allowed !== undefined && counts[metric.id] < allowed ? `  (budget ${allowed}: lower it with --update)` : ''
    console.log(`${metric.id.padEnd(width)}  ${String(counts[metric.id]).padStart(5)}  ${metric.what}${slack}`)
  }

  if (args.includes('--check')) {
    const problems = overBudget(counts, budget)
    if (problems.length > 0) {
      console.error(
        `\nDesign consistency regressed (docs/specs/DESIGN_SYSTEM.md):\n${problems.map((p) => `  ${p}`).join('\n')}`,
      )
      process.exit(1)
    }
    console.log('\nNo design-consistency count rose.')
  }
}

if (process.argv[1]?.endsWith('report-design-metrics.ts')) main()
