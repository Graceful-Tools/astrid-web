/**
 * AWTD-1649: the strings web and iOS share come from astrid-core's shared catalog.
 *
 * `lib/i18n/core-strings/` vendors core's generated web strings and `sources.json` (each shared
 * key's web keys) at the revision in REVISION. `scripts/sync-core-strings.mjs` writes core's
 * value into every mapped web key. This test is the ratchet: a hand edit to a shared string in
 * lib/i18n/locales/ fails here, because the fix belongs in astrid-core's catalog.
 *
 * A mapped key is held only when web's English equals core's and both carry the same
 * {arguments} — the same rule the sync script applies, so the two cannot disagree.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { locales } from '@/lib/i18n/config'
import {
  SHORT_STRING_MAX_WORDS,
  divergenceIds,
  isShortString,
  parseCsv,
  reviewDecisions,
  sharedStringPlan,
  toCsv,
} from '@/scripts/lib/core-strings.mjs'

const root = process.cwd()
const vendored = join(root, 'lib', 'i18n', 'core-strings')
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

const plan = () => sharedStringPlan({
  sources: readJson(join(vendored, 'sources.json')),
  core: Object.fromEntries(locales.map(l => [l, readJson(join(vendored, 'web', `${l}.json`))])),
  web: Object.fromEntries(locales.map(l => [l, readJson(join(root, 'lib', 'i18n', 'locales', `${l}.json`))])),
})

describe('shared strings come from astrid-core (AWTD-1649)', () => {
  it('AWTD-1649: the core catalog is vendored at a pinned revision', () => {
    expect(readFileSync(join(vendored, 'REVISION'), 'utf8').trim()).toMatch(/^[0-9a-f]{40}$/)
    expect(existsSync(join(vendored, 'sources.json'))).toBe(true)
    for (const locale of locales) {
      expect(existsSync(join(vendored, 'web', `${locale}.json`)), locale).toBe(true)
    }
  })


  it('AWTD-1649: every mapped web key carries core\'s value, unless it is on the divergence list', () => {
    const allowed = new Set<string>(readJson(join(vendored, 'divergent.json')).pairs)
    const { pairs } = plan()
    expect(pairs.length).toBeGreaterThan(5000)
    // A shared string edited by hand on web lands here: change it in astrid-core's catalog.
    expect(pairs.filter(p => p.status !== 'agree' && !allowed.has(`${p.locale} ${p.webKey}`))
      .map(p => `${p.locale} ${p.webKey}: web ${JSON.stringify(p.current)}, core ${JSON.stringify(p.core)}`)).toEqual([])
  })

  it('AWTD-1649: the divergence list only shrinks — a settled pair leaves it', () => {
    const listed: string[] = readJson(join(vendored, 'divergent.json')).pairs
    const stillDivergent = new Set(divergenceIds(plan().pairs))
    // Run `node scripts/sync-core-strings.mjs --update-divergent` after settling a pair.
    expect(listed.filter(id => !stillDivergent.has(id))).toEqual([])
  })

  it('AWTD-1649: English is never divergent — every mapped English string is core\'s', () => {
    expect(plan().pairs.filter(p => p.locale === 'en' && p.status !== 'agree').map(p => p.webKey)).toEqual([])
  })

  it('AWTD-1649: the plan tells agreement, difference and a two-key conflict apart', () => {
    const { pairs, skipped } = sharedStringPlan({
      sources: { keys: {
        add: { web: ['actions.add'] },
        'actions.add': { web: ['actions.add'] },
        save: { web: ['actions.save'] },
        greet: { web: ['hello'] },
      } },
      core: {
        en: { add: 'Add', actions_add: 'Add', save: 'Save', greet: 'Hi {name}' },
        es: { add: 'Añadir', actions_add: 'Agregar', save: 'Guardar', greet: 'Hola {name}' },
      },
      web: {
        en: { actions: { add: 'Add', save: 'Save' }, hello: 'Hello {name}' },
        es: { actions: { add: 'Agregar', save: 'Salvar' }, hello: 'Hola {name}' },
      },
    })
    const status = Object.fromEntries(pairs.map(p => [`${p.locale} ${p.webKey}`, p.status]))
    expect(status).toEqual({
      'en actions.add': 'agree', 'es actions.add': 'conflict',
      'en actions.save': 'agree', 'es actions.save': 'differ',
    })
    expect(skipped).toEqual([{ webKey: 'hello', sharedKey: 'greet', reason: 'English differs' }])
  })
})

describe('where web and iOS differ, short strings take iOS\'s wording (AWTD-1654)', () => {
  // Jon, 2026-11-14, on "whose wording wins": "3, but defer to iOS for short strings". Core took
  // iOS's translations, so a short string that differs takes core's value; longer ones and the
  // two-translation conflicts wait on the native-speaker review sheet.
  it('AWTD-1654: a short string is a button or label, three English words or fewer', () => {
    expect(SHORT_STRING_MAX_WORDS).toBe(3)
    expect(isShortString('Sign in')).toBe(true)
    expect(isShortString('Mark {count} done')).toBe(true)
    expect(isShortString('No lists yet. Create your first list to get started!')).toBe(false)
  })

  it('AWTD-1654: no short string stays on the divergence list', () => {
    const listed = new Set<string>(readJson(join(vendored, 'divergent.json')).pairs)
    const shortDiffer = plan().pairs.filter(p => p.status === 'differ' && isShortString(p.english))
    expect(shortDiffer.filter(p => listed.has(`${p.locale} ${p.webKey}`)).map(p => `${p.locale} ${p.webKey}`)).toEqual([])
  })

  it('AWTD-1654: a short difference leaves the list, a conflict and a long difference stay', () => {
    const ids = divergenceIds([
      { locale: 'fr', webKey: 'auth.signIn', status: 'differ', english: 'Sign in' },
      { locale: 'de', webKey: 'emptyState.noLists', status: 'differ', english: 'No lists yet. Create your first list to get started!' },
      { locale: 'es', webKey: 'actions.add', status: 'conflict', english: 'Add' },
    ])
    expect(ids).toEqual(['de emptyState.noLists', 'es actions.add'])
  })
})

describe('the native-speaker review sheet (AWTD-1654)', () => {
  it('AWTD-1654: the sheets list exactly what is still divergent', () => {
    // Run `node scripts/sync-core-strings.mjs --review-sheet` after the list changes.
    const dir = join(vendored, 'review')
    const onSheets = readdirSync(dir)
      .filter(f => f.endsWith('.csv'))
      .flatMap(f => parseCsv(readFileSync(join(dir, f), 'utf8')).map(r => `${f.replace(/\.csv$/, '')} ${r.web_key}`))
      .sort()
    expect(onSheets).toEqual([...readJson(join(vendored, 'divergent.json')).pairs].sort())
  })

  it('AWTD-1654: a sheet survives a round trip, commas, quotes and newlines included', () => {
    const rows = [{ web_key: 'a.b', kind: 'differ', english: 'Hi, "you"', web: 'x\ny', ios: 'z', shared_keys: 'a', choice: '' }]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })

  it('AWTD-1654: ios takes a difference off the list; web or new wording goes to core first', () => {
    const { takeIos, changeInCore } = reviewDecisions('de', [
      { web_key: 'k1', kind: 'differ', web: 'W1', choice: 'ios' },
      { web_key: 'k2', kind: 'differ', web: 'W2', choice: 'web' },
      { web_key: 'k3', kind: 'conflict', web: 'W3', choice: 'Neu' },
      { web_key: 'k4', kind: 'conflict', web: 'W4', choice: 'ios' },
      { web_key: 'k5', kind: 'differ', web: 'W5', choice: '' },
    ])
    expect(takeIos).toEqual(['de k1'])
    expect(changeInCore.map(c => [c.id, c.wording])).toEqual([['de k2', 'W2'], ['de k3', 'Neu'], ['de k4', null]])
  })
})
