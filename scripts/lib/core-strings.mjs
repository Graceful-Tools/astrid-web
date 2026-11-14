/**
 * The plan that puts astrid-core's shared strings into web's locale files (AWTD-1649).
 *
 * Pure: it takes the vendored core output, core's `sources.json` and web's locale objects, and
 * says which web keys are held to core and which values differ. scripts/sync-core-strings.mjs
 * applies it; tests/i18n/core-shared-strings-awtd-1649.test.ts asserts it has nothing to change.
 * One function, so the writer and the ratchet cannot disagree about what is shared.
 *
 * A web key is held to core only when its English is core's English, character for character,
 * and both name the same {arguments}. Anything else is reported as skipped, never rewritten:
 * a value that means something else on web must not be overwritten because the words collide.
 */

/** Core's web output flattens its dotted keys with underscores (`time.at_due_time` → `time_at_due_time`). */
export function coreWebKey(sharedKey) {
  return sharedKey.replaceAll('.', '_')
}

export function getPath(object, dotted) {
  let node = object
  for (const part of dotted.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    node = node[part]
  }
  return node
}

export function setPath(object, dotted, value) {
  const parts = dotted.split('.')
  let node = object
  for (const part of parts.slice(0, -1)) node = node[part]
  node[parts.at(-1)] = value
}

/** The ICU argument names a message uses, sorted: `{count, plural, …}` and `{name}` both count. */
export function argumentNames(message) {
  if (typeof message !== 'string') return ''
  return [...new Set([...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map(m => m[1]))].sort().join(',')
}

/**
 * Every (locale, web key) pair core's map names, with how web's value stands against core's:
 *   - `agree`:    web already says what core says;
 *   - `differ`:   one core value, and web says something else;
 *   - `conflict`: two shared keys claim this web key with different values (core's map is not
 *                 one-to-one: `add` and `actions.add` both name web's `actions.add`), so there is
 *                 no single core value to hold it to.
 * Web keys whose English or {arguments} differ from core's are `skipped`, never compared.
 *
 * @param {{ sources: { keys: Record<string, { web?: string[] }> },
 *           core: Record<string, Record<string, string>>,
 *           web: Record<string, object> }} input  core and web keyed by locale; `en` required
 */
export function sharedStringPlan({ sources, core, web }) {
  const claims = new Map() // web key -> shared keys whose English and arguments match it
  const skipped = []
  for (const [sharedKey, entry] of Object.entries(sources.keys)) {
    const coreEnglish = core.en?.[coreWebKey(sharedKey)]
    for (const webKey of entry.web ?? []) {
      const webEnglish = getPath(web.en, webKey)
      let reason = null
      if (typeof coreEnglish !== 'string') reason = "not in core's web output"
      else if (webEnglish !== coreEnglish) reason = 'English differs'
      else if (argumentNames(webEnglish) !== argumentNames(coreEnglish)) reason = 'arguments differ'
      if (reason) skipped.push({ webKey, sharedKey, reason })
      else claims.set(webKey, [...(claims.get(webKey) ?? []), sharedKey])
    }
  }

  const pairs = []
  for (const [webKey, sharedKeys] of [...claims].sort(([a], [b]) => a.localeCompare(b))) {
    const english = getPath(web.en, webKey)
    for (const locale of Object.keys(web)) {
      const current = getPath(web[locale], webKey)
      if (typeof current !== 'string') continue
      const values = [...new Set(sharedKeys
        .map(key => core[locale]?.[coreWebKey(key)])
        .filter(value => typeof value === 'string' && argumentNames(value) === argumentNames(english)))]
      if (values.length === 0) continue
      const status = values.length > 1 ? 'conflict' : values[0] === current ? 'agree' : 'differ'
      pairs.push({ locale, webKey, sharedKeys, status, current, core: values.length === 1 ? values[0] : values })
    }
  }
  return { mapped: [...claims.keys()], skipped, pairs }
}

/** The committed form of the divergence list: `locale webKey`, sorted. */
export function divergenceIds(pairs) {
  return pairs.filter(p => p.status !== 'agree').map(p => `${p.locale} ${p.webKey}`).sort()
}
