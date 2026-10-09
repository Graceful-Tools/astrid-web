// Runs astrid-web's smart task parser over a set of inputs, under a fixed clock, and prints what
// it answers — plus the keyword tables for every locale, so the client reads the same words.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Executed rather than parsed: the parser is an ordered pipeline of regexes whose alternation
// order, boundary rules and CJK handling decide the answer, and the only honest way to lock
// those is to run the canonical implementation. The clock is pinned because "tomorrow" is a
// date, and TZ=UTC (set by the exporter) because the web computes it in local time.
//
// Usage: node scripts/contract-fixtures/drivers/smart.mjs <path-to-astrid-web>

import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2] && resolve(process.argv[2])
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/smart.mjs <path-to-astrid-web>')
  process.exit(2)
}

// A Wednesday, mid-morning. Every relative date in the fixture is relative to this.
const NOW = '2026-09-09T10:30:00.000Z'
const RealDate = Date
class FixedDate extends RealDate {
  constructor(...args) {
    super(...(args.length === 0 ? [NOW] : args))
  }
  static now() {
    return new RealDate(NOW).getTime()
  }
}
globalThis.Date = FixedDate

registerWebAliases(webRoot)

const { parseTaskInput } = await import(pathToFileURL(join(webRoot, 'lib/task-manager-utils.ts')).href)
const { nlpKeywords } = await import(pathToFileURL(join(webRoot, 'lib/i18n/nlp-keywords.ts')).href)

const LISTS = [
  { id: 'h', name: 'Health', isVirtual: false },
  { id: 's', name: 'Side Projects', isVirtual: false },
  { id: 'today', name: 'Today', isVirtual: true },
]

// English, spelled out, because these are the inputs people actually type.
const CASES = [
  ['en', 'Buy milk', 'h'],
  ['en', 'Pushups #health', 's'],
  ['en', '#health', 's'],
  ['en', 'Call mum tomorrow', 'h'],
  ['en', 'Dentist next week', 'h'],
  ['en', 'Report this week', 'h'],
  ['en', 'Gym friday', 'h'],
  ['en', 'Gym fri', 'h'],
  ['en', 'Gym wednesday', 'h'],
  ['en', 'Monday standup', 'h'],
  ['en', 'today', 'h'],
  ['en', 'Standup weekly monday', 'h'],
  ['en', 'Standup weekly mon and wed', 'h'],
  ['en', 'Standup weekly Mon, Tue, Thu', 'h'],
  ['en', 'Standup every week friday', 'h'],
  ['en', 'Water plants daily', 'h'],
  ['en', 'Water plants every day', 'h'],
  ['en', 'Rent monthly', 'h'],
  ['en', 'Taxes yearly', 'h'],
  ['en', 'Taxes annually', 'h'],
  ['en', 'Pay rent every month', 'h'],
  ['en', 'Standup weekly', 'h'],
  ['en', 'Fix crash urgent', 'h'],
  ['en', 'Fix crash asap', 'h'],
  ['en', 'Read the paper high priority', 'h'],
  ['en', 'Tidy the desk low priority', 'h'],
  ['en', 'Sort photos medium priority', 'h'],
  ['en', 'Ship it today high priority #side-projects', 'h'],
  ['en', 'Ship it tomorrow urgent #side_projects', 'today'],
  ['en', 'Tomorrowland tickets', 'h'],
  ['en', 'Daily Mail subscription', 'h'],
  ['en', 'C# homework monthly', 'h'],
  ['en', 'Book flights TOMORROW', 'h'],
]

// Every other locale, built from its own table so nothing here has to know the words.
for (const [locale, kw] of Object.entries(nlpKeywords)) {
  if (locale === 'en') continue
  const d = kw.dates, p = kw.priorities, r = kw.repeating
  CASES.push(
    [locale, `Task ${d.tomorrow[0]}`, 'h'],
    [locale, `${d.today[0]} Task`, 'h'],
    [locale, `Task ${d.thisWeek[0]}`, 'h'],
    [locale, `Task ${d.nextWeek[0]}`, 'h'],
    [locale, `Task ${d.tuesday[0]}`, 'h'],
    [locale, `Task ${d.saturday[d.saturday.length - 1]}`, 'h'],
    [locale, `Task ${r.weekly[0]} ${d.monday[0]}`, 'h'],
    [locale, `Task ${r.weekly[0]} ${d.monday[0]} and ${d.wednesday[0]}`, 'h'],
    [locale, `Task ${r.daily[0]}`, 'h'],
    [locale, `Task ${r.everyDay[0]}`, 'h'],
    [locale, `Task ${r.monthly[0]}`, 'h'],
    [locale, `Task ${r.yearly[0]}`, 'h'],
    [locale, `Task ${p.highest[0]}`, 'h'],
    [locale, `Task ${p.high[0]}`, 'h'],
    [locale, `Task ${p.medium[0]}`, 'h'],
    [locale, `Task ${p.low[0]}`, 'h'],
    [locale, `${d.tomorrow[0]} ${p.highest[0]} #health Task`, 's'],
  )
}

const cases = CASES.map(([locale, input, selectedListId]) => {
  const parsed = parseTaskInput(input, selectedListId, undefined, LISTS, false, locale)
  return {
    locale,
    input,
    selectedListId,
    title: parsed.title,
    listIds: parsed.listIds,
    dueDate: parsed.dueDateTime ? new RealDate(parsed.dueDateTime).toISOString() : null,
    priority: parsed.priority ?? null,
    repeating: parsed.repeating ?? null,
    weekdays: parsed.customRepeatingData?.weekdays ?? [],
  }
})

process.stdout.write(
  JSON.stringify({
    generatedFrom: 'lib/task-manager-utils.ts (parseTaskInput) and lib/i18n/nlp-keywords.ts',
    now: NOW,
    lists: LISTS,
    keywords: nlpKeywords,
    cases,
  }),
)
