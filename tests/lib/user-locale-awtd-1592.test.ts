/**
 * AWTD-1592 — server-rendered copy follows the recipient's language.
 *
 * Push notifications and reminder/digest emails are rendered with no request to
 * take a language from, so the user's language is stored (`User.locale`) and
 * read back here. These pin the two halves: what a client may send is narrowed
 * to one of the app's twelve locales, and the translator answers in it — or in
 * English when nothing is known, which is what every one of these messages said
 * before.
 */
import { describe, expect, it } from 'vitest'
import { normalizeLocale, getNotificationTranslator } from '@/lib/i18n/user-locale'

describe('normalizeLocale (AWTD-1592)', () => {
  it.each([
    ['de', 'de'],
    ['de-DE', 'de'],
    ['DE_at', 'de'],
    ['en-US', 'en'],
    ['pt-BR', 'pt'],
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    // Apple and Android spell Chinese by script, not region.
    ['zh-Hans', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh', 'zh-CN'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected)
  })

  it.each([['xx'], [''], ['   '], [42], [null], [undefined], [{}], ['de; DROP TABLE']])(
    'refuses %j',
    (input) => {
      expect(normalizeLocale(input)).toBeNull()
    },
  )
})

describe('getNotificationTranslator (AWTD-1592)', () => {
  it('answers in English when the language is unknown', async () => {
    const t = await getNotificationTranslator(null)
    expect(t('push.overdueTitle')).toBe('Task Overdue')
    expect(t('push.overdueBody', { title: 'Pay rent' })).toBe('Pay rent is overdue')
  })

  it('answers in the user’s language', async () => {
    const t = await getNotificationTranslator('de')
    const english = await getNotificationTranslator('en')
    expect(t('push.overdueTitle')).not.toBe(english('push.overdueTitle'))
    expect(t('push.overdueBody', { title: 'Miete zahlen' })).toContain('Miete zahlen')
  })

  it('reads a stored value that is not one of the twelve as English', async () => {
    const t = await getNotificationTranslator('klingon')
    expect(t('push.overdueTitle')).toBe('Task Overdue')
  })

  it('substitutes the brand name', async () => {
    const t = await getNotificationTranslator('en')
    expect(t('push.testBody')).not.toContain('{appName}')
  })
})
