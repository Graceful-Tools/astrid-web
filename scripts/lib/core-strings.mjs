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
      pairs.push({ locale, webKey, sharedKeys, status, english, current, core: values.length === 1 ? values[0] : values })
    }
  }
  return { mapped: [...claims.keys()], skipped, pairs }
}

/**
 * Where web and iOS translate a shared string differently, a SHORT one takes iOS's wording
 * (Jon, 2026-11-14, AWTD-1654: "defer to iOS for short strings"). Core's catalog carries iOS's
 * translations, so taking core's value is taking iOS's. Short means a button or label: three
 * English words or fewer, an {argument} counting as one.
 */
export const SHORT_STRING_MAX_WORDS = 3

export function isShortString(english) {
  if (typeof english !== 'string') return false
  return english.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, 'x').trim().split(/\s+/).length <= SHORT_STRING_MAX_WORDS
}

/**
 * The committed form of the divergence list: `locale webKey`, sorted. A short `differ` never
 * stays on it (iOS wins those); a long one and every two-key `conflict` stay until the
 * native-speaker review settles them.
 */
export function divergenceIds(pairs) {
  return pairs
    .filter(p => p.status !== 'agree' && !(p.status === 'differ' && isShortString(p.english)))
    .map(p => `${p.locale} ${p.webKey}`)
    .sort()
}

// ── The native-speaker review sheet (AWTD-1654) ─────────────────────────────────────────────
//
// What is left on the divergence list after the short-string rule — long strings whose web and
// iOS translations differ, and the web keys two shared keys claim with different values — is
// settled per string by someone who speaks the language. One CSV per locale under
// lib/i18n/core-strings/review/, with an empty `choice` column to fill in:
//   ios  → take iOS's (core's) wording: `--apply-review` drops the pair and the sync writes it;
//   web  → keep web's wording: it has to become core's, so `--apply-review` lists it for a core
//          change and leaves it on the list until that change is vendored;
//   other text → a new wording, which also belongs in core's catalog. Listed the same way.
// A conflict has no single iOS value, so only `web` or a new wording settles it.

export const REVIEW_COLUMNS = ['web_key', 'kind', 'english', 'web', 'ios', 'shared_keys', 'choice']

/** Rows for every pair on the divergence list, grouped by locale, keyed for the CSV. */
export function reviewRows(pairs, divergent) {
  const listed = new Set(divergent)
  const byLocale = {}
  for (const p of pairs) {
    if (!listed.has(`${p.locale} ${p.webKey}`)) continue
    ;(byLocale[p.locale] ??= []).push({
      web_key: p.webKey,
      kind: p.status,
      english: p.english,
      web: p.current,
      ios: Array.isArray(p.core) ? p.core.join(' ‖ ') : p.core,
      shared_keys: p.sharedKeys.join(' '),
      choice: '',
    })
  }
  return byLocale
}

const csvCell = value => (/[",\n\r]/.test(value) ? `"${String(value).replaceAll('"', '""')}"` : String(value))

export function toCsv(rows) {
  return [REVIEW_COLUMNS.join(','), ...rows.map(r => REVIEW_COLUMNS.map(c => csvCell(r[c] ?? '')).join(','))].join('\n') + '\n'
}

/** RFC 4180, enough for what toCsv writes and what a spreadsheet saves back. */
export function parseCsv(text) {
  const records = []
  let record = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { record.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      record.push(cell); records.push(record); record = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || record.length) { record.push(cell); records.push(record) }
  const [header, ...body] = records.filter(r => r.some(c => c !== ''))
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])))
}

/**
 * What a filled-in sheet decides, for one locale: the pairs iOS wins (they leave the list) and
 * the ones whose wording must change in core first (they stay until it is vendored).
 */
export function reviewDecisions(locale, rows) {
  const takeIos = []
  const changeInCore = []
  for (const row of rows) {
    const choice = (row.choice ?? '').trim()
    if (!choice) continue
    const id = `${locale} ${row.web_key}`
    if (choice.toLowerCase() === 'ios' && row.kind === 'differ') takeIos.push(id)
    else if (choice.toLowerCase() === 'web') changeInCore.push({ id, wording: row.web })
    else if (choice.toLowerCase() !== 'ios') changeInCore.push({ id, wording: choice })
    else changeInCore.push({ id, wording: null, note: 'a conflict has no single iOS value; write the wording' })
  }
  return { takeIos, changeInCore }
}
