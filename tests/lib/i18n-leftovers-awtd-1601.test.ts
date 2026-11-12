/**
 * AWTD-1601 — what still showed in English for a non-English reader after the
 * audit: dates and times, the board's column names and blurbs, OAuth scope
 * descriptions, passkey errors, the /start agent copy, and keys whose value
 * was English in every locale.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatDateForDisplay } from '@/lib/date-utils'
import {
  formatClockTime,
  formatConciseClockTime,
  formatDateAtTime,
  formatRelativeFromNow,
  formatShortDate,
} from '@/lib/i18n/date-format'
import { dateFnsLocaleFor } from '@/lib/i18n/date-fns-locale'
import { boardColumnBlurb, boardColumnLabel } from '@/lib/board-column-labels'
import { getProjectBoardColumns } from '@/lib/project-status'
import { boardColumnsFor } from '@/lib/task-status'
import { localizedScopeDescription, OAUTH_SCOPES } from '@/lib/oauth/oauth-scopes'
import { STARTER_AGENTS } from '@/lib/start-here/business-blueprint'
import { starterAgentCopy } from '@/lib/start-here/starter-agent-copy'
import en from '@/lib/i18n/locales/en.json'
import de from '@/lib/i18n/locales/de.json'
import ja from '@/lib/i18n/locales/ja.json'
import es from '@/lib/i18n/locales/es.json'
import fr from '@/lib/i18n/locales/fr.json'
import it_ from '@/lib/i18n/locales/it.json'
import pt from '@/lib/i18n/locales/pt.json'
import nl from '@/lib/i18n/locales/nl.json'
import ru from '@/lib/i18n/locales/ru.json'
import ko from '@/lib/i18n/locales/ko.json'
import zhCN from '@/lib/i18n/locales/zh-CN.json'
import zhTW from '@/lib/i18n/locales/zh-TW.json'

type Messages = Record<string, unknown>
const OTHERS: Record<string, Messages> = { de, ja, es, fr, it: it_, pt, nl, ru, ko, 'zh-CN': zhCN, 'zh-TW': zhTW }

function lookup(messages: Messages, key: string): string | undefined {
  let value: unknown = messages
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return typeof value === 'string' ? value : undefined
}

/** The same contract as lib/i18n/client's `t`: the key itself when missing. */
function translator(messages: Messages) {
  return (key: string, replacements?: Record<string, string>) => {
    const value = lookup(messages, key)
    if (value === undefined) return key
    return Object.entries(replacements ?? {}).reduce((s, [k, v]) => s.replace(`{${k}}`, () => v), value)
  }
}

const tDe = translator(de)
const tEn = translator(en)

describe('AWTD-1601 dates and times follow the active locale', () => {
  // Fixed dates below are compared with "today"; pin it well away from them.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('AWTD-1601: the relative words come from the locale files', () => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
    expect(formatDateForDisplay(tomorrow, false, { locale: 'de', t: tDe })).toBe('Morgen')
    expect(formatDateForDisplay(new Date(), false, { locale: 'ja', t: translator(ja) })).toBe(lookup(ja, 'time.today'))
  })

  it('AWTD-1601: a date is spelt by Intl in the reader\'s language, English unchanged', () => {
    const date = new Date(Date.UTC(2026, 10, 14))
    expect(formatDateForDisplay(date, true)).toBe('Nov 14, 2026')
    expect(formatDateForDisplay(date, true, { locale: 'de', t: tDe })).toBe(formatShortDate(date, 'de', { timeZone: 'UTC' }))
    expect(formatDateForDisplay(date, true, { locale: 'de', t: tDe })).not.toContain('Nov 14')
  })

  it('AWTD-1601: times are the locale\'s own clock; English keeps 9:30 AM and 5pm', () => {
    const date = new Date(2026, 10, 14, 17, 0)
    expect(formatConciseClockTime(date, 'en')).toBe('5pm')
    expect(formatConciseClockTime(new Date(2026, 10, 14, 17, 30), 'en')).toBe('5:30pm')
    expect(formatConciseClockTime(date, 'de')).toBe('17:00')
    expect(formatClockTime(new Date(2026, 10, 14, 9, 30), 'en')).toBe('9:30 AM')
    expect(formatClockTime(new Date(2026, 10, 14, 9, 30), 'de')).toBe('9:30')
  })

  it('AWTD-1601: "Nov 11 at 4:24 AM" reads naturally in German', () => {
    const date = new Date(2026, 10, 11, 4, 24)
    expect(formatDateAtTime(date, 'en', tEn)).toBe('Nov 11 at 4:24 AM')
    const german = formatDateAtTime(date, 'de', tDe)
    expect(german).toContain(' um ')
    expect(german).toContain('4:24')
    expect(german).not.toContain('AM')
  })

  it('AWTD-1601: a snooze span is localized', () => {
    expect(formatRelativeFromNow(1440 * 60000, 'en')).toBe('in 1 day')
    expect(formatRelativeFromNow(1440 * 60000, 'de')).toBe('in 1 Tag')
  })

  it('AWTD-1601: the calendar gets a date-fns locale for every non-English app locale', () => {
    expect(dateFnsLocaleFor('en')).toBeUndefined()
    for (const locale of Object.keys(OTHERS)) expect(dateFnsLocaleFor(locale)).toBeDefined()
    expect(dateFnsLocaleFor('de')?.code).toBe('de')
  })
})

describe('AWTD-1601 board column names and blurbs', () => {
  it('AWTD-1601: built-in columns are translated, in both column builders', () => {
    for (const columns of [getProjectBoardColumns([]), boardColumnsFor(null)]) {
      expect(columns.map(column => boardColumnLabel(column, tDe))).toEqual(['Eingang', 'Bereit', 'In Arbeit', 'Wartet', 'Erledigt'])
      for (const column of columns) {
        expect(boardColumnBlurb(column, tDe)).not.toBe(column.description)
      }
    }
  })

  it("AWTD-1601: a board's own words are never translated", () => {
    const columns = getProjectBoardColumns([
      { role: 'ready', name: 'Up next', description: 'Our queue', order: 0 },
      { role: 'custom-review', name: 'Review', order: 1 },
    ])
    const ready = columns.find(column => column.id === 'ready')!
    const review = columns.find(column => column.id === 'custom-review')!
    expect(boardColumnLabel(ready, tDe)).toBe('Up next')
    expect(boardColumnLabel(review, tDe)).toBe('Review')
  })

  it('AWTD-1601: English reads exactly as before', () => {
    const columns = getProjectBoardColumns([])
    expect(columns.map(column => boardColumnLabel(column, tEn))).toEqual(columns.map(column => column.name))
    expect(columns.map(column => boardColumnBlurb(column, tEn))).toEqual(columns.map(column => column.description))
  })
})

describe('AWTD-1601 strings from lib', () => {
  it('AWTD-1601: every OAuth scope has a description in every locale', () => {
    for (const scope of Object.keys(OAUTH_SCOPES)) {
      expect(localizedScopeDescription(scope, tEn)).toBe(OAUTH_SCOPES[scope as keyof typeof OAUTH_SCOPES])
      for (const [locale, messages] of Object.entries(OTHERS)) {
        const text = localizedScopeDescription(scope, translator(messages))
        expect(text, `${locale} ${scope}`).not.toBe(OAUTH_SCOPES[scope as keyof typeof OAUTH_SCOPES])
      }
    }
  })

  it('AWTD-1601: the /start agent copy is translated, English unchanged', () => {
    for (const agent of STARTER_AGENTS) {
      const english = starterAgentCopy(agent, tEn)
      expect(english.role).toBe(agent.role)
      expect(english.plan).toBe(agent.plan)
      expect(english.runs).toBe(agent.runs)
      expect(english.extraSteps).toEqual(agent.extraSteps)
      const german = starterAgentCopy(agent, tDe)
      expect(german.role).not.toBe(agent.role)
      expect(german.runs).not.toBe(agent.runs)
      expect(german.extraSteps.join('')).not.toMatch(/\{\w+\}/)
    }
  })
})

describe('AWTD-1601 keys that were English in every locale', () => {
  const FIXED = [
    'projectMode.boardViewLabel',
    'projectMode.boardViewDescriptionEnabled',
    'projectMode.requestAccess',
    'projectMode.requestDialogTitle',
    'projectMode.requestDialogBody',
    'projectMode.requestDialogSubmit',
    'projectMode.requestFailed',
    'settingsPages.chatgpt.mcp.title',
    'settingsPages.chatgpt.mcp.description',
    'settingsPages.chatgpt.mcp.note',
    'settingsPages.aiIntegrations.mcp.title',
    'settingsPages.apiAccess.clientGuide.dcrNote',
    'settingsPages.appearancePage.theme.ocean',
    'listSettings.admin.readyStatus',
  ]
  it('AWTD-1601: now translated in every locale', () => {
    for (const key of FIXED) {
      const english = lookup(en, key)
      expect(english, key).toBeTruthy()
      for (const [locale, messages] of Object.entries(OTHERS)) {
        expect(lookup(messages, key), `${locale} ${key}`).not.toBe(english)
      }
    }
  })
})

describe('AWTD-1601 passkey errors', () => {
  it('AWTD-1601: a browser refusal wrapped by @simplewebauthn/browser counts as a browser error', async () => {
    const { isBrowserError } = await import('@/hooks/use-webauthn')
    const { WebAuthnError } = await import('@simplewebauthn/browser')
    const cause = new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError')
    const wrapped = new WebAuthnError({ message: 'Registration ceremony was sent an abort signal', code: 'ERROR_CEREMONY_ABORTED', cause })
    expect(isBrowserError(cause)).toBe(true)
    expect(isBrowserError(wrapped)).toBe(true)
    expect(isBrowserError(new Error('No passkey found for this email'))).toBe(false)
  })
})
