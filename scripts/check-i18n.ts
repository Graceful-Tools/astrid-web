#!/usr/bin/env npx tsx
/**
 * Locale key-parity gate (task d818849d).
 *
 * en.json is the source of truth. Every key in it must exist in every other
 * locale, and no locale may carry a key en does not.
 *
 * This exists because the Custom Agents settings feature shipped with 42 keys
 * in en only — the same 42 missing from all eleven other locales, which is what
 * a whole feature falling out of translation at once looks like. Nothing
 * caught it because nothing was looking.
 *
 * Run by `npm run check:i18n`, and by predeploy. The same rules are asserted
 * from tests/i18n/key-parity.test.ts so a `vitest` run catches it too.
 */

import { readdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'

const LOCALES_DIR = join(process.cwd(), 'lib/i18n/locales')
const SOURCE_LOCALE = 'en'

type Messages = { [key: string]: string | Messages }

function flatten(obj: Messages, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null ? flatten(value, path) : [path]
  })
}

function load(locale: string): Messages {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8'))
}

function main() {
  const locales = readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => basename(f, '.json'))

  if (!locales.includes(SOURCE_LOCALE)) {
    console.error(`❌ No ${SOURCE_LOCALE}.json in ${LOCALES_DIR}`)
    process.exit(1)
  }

  const sourceKeys = new Set(flatten(load(SOURCE_LOCALE)))
  const targets = locales.filter((l) => l !== SOURCE_LOCALE)

  console.log(`\n🌍 check:i18n — ${sourceKeys.size} keys in ${SOURCE_LOCALE}.json, ${targets.length} other locales\n`)

  let failed = false

  for (const locale of targets) {
    const keys = new Set(flatten(load(locale)))
    const missing = [...sourceKeys].filter((k) => !keys.has(k)).sort()
    const stale = [...keys].filter((k) => !sourceKeys.has(k)).sort()

    if (missing.length === 0 && stale.length === 0) {
      console.log(`✅ ${locale}`)
      continue
    }

    failed = true
    console.log(`❌ ${locale}`)
    if (missing.length) {
      console.log(`   ${missing.length} key(s) missing:`)
      for (const key of missing.slice(0, 15)) console.log(`     - ${key}`)
      if (missing.length > 15) console.log(`     … and ${missing.length - 15} more`)
    }
    if (stale.length) {
      console.log(`   ${stale.length} key(s) not in ${SOURCE_LOCALE}.json:`)
      for (const key of stale.slice(0, 15)) console.log(`     + ${key}`)
      if (stale.length > 15) console.log(`     … and ${stale.length - 15} more`)
    }
  }

  console.log('')
  if (failed) {
    console.error('❌ Locale key parity failed. Add the missing keys (translated, not copied from en).')
    process.exit(1)
  }
  console.log('✅ All locales are in key parity.\n')
}

main()
