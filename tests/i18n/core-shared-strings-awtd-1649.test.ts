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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { locales } from '@/lib/i18n/config'
import { divergenceIds, sharedStringPlan } from '@/scripts/lib/core-strings.mjs'

const root = process.cwd()
const vendored = join(root, 'lib', 'i18n', 'core-strings')
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

describe('shared strings come from astrid-core (AWTD-1649)', () => {
  it('AWTD-1649: the core catalog is vendored at a pinned revision', () => {
    expect(readFileSync(join(vendored, 'REVISION'), 'utf8').trim()).toMatch(/^[0-9a-f]{40}$/)
    expect(existsSync(join(vendored, 'sources.json'))).toBe(true)
    for (const locale of locales) {
      expect(existsSync(join(vendored, 'web', `${locale}.json`)), locale).toBe(true)
    }
  })

  const plan = () => sharedStringPlan({
    sources: readJson(join(vendored, 'sources.json')),
    core: Object.fromEntries(locales.map(l => [l, readJson(join(vendored, 'web', `${l}.json`))])),
    web: Object.fromEntries(locales.map(l => [l, readJson(join(root, 'lib', 'i18n', 'locales', `${l}.json`))])),
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
