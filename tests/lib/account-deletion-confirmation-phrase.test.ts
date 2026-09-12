/**
 * AWTD-921: the delete-account prompt asked for a phrase the server rejects.
 *
 * Found while adding German to the Windows app, reported as a German bug, and
 * true of ELEVEN locales: every non-English translation had translated the
 * literal token the user has to type.
 *
 *   de  "Geben Sie MEIN KONTO LÖSCHEN zur Bestätigung ein"
 *   ru  "Введите УДАЛИТЬ МОЙ АККАУНТ для подтверждения"
 *   ...
 *
 * while both delete routes compare against the English `DELETE MY ACCOUNT` and
 * nothing else. So a user in any of those languages who typed exactly what the
 * dialog told them to type could not delete their account — the button stayed
 * disabled, and had it not, the server would have answered 400.
 *
 * THE PHRASE IS A PROTOCOL TOKEN, NOT PROSE. It is compared byte-for-byte on
 * the server, so it cannot be translated; the sentence around it is prose and
 * should be. The locales therefore interpolate `{phrase}` from the one
 * constant the server also compares against, rather than each spelling the
 * token out — a literal copied into twelve files is one careless translation
 * away from exactly this bug returning.
 *
 * These assertions are over the locale FILES rather than through the component,
 * because the defect was in the files and a component test would have kept
 * passing in English forever.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ACCOUNT_DELETION_CONFIRMATION_PHRASE } from '@/lib/account-deletion'

const LOCALES_DIR = join(process.cwd(), 'lib/i18n/locales')

function localeNames(): string[] {
  return readdirSync(LOCALES_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
}

function typeToConfirm(locale: string): string {
  const messages = JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8'))
  return messages.settingsPages.deleteAccount.typeToConfirm
}

/** The i18n client's substitution, so the test checks what a user actually reads. */
function render(template: string, phrase: string): string {
  return template.replace('{phrase}', phrase)
}

describe('the delete-account prompt asks for the phrase the server accepts (AWTD-921)', () => {
  const locales = localeNames()

  it('there are twelve locales, so none of the checks below is vacuous', () => {
    expect(locales.length).toBe(12)
    expect(locales).toContain('en')
    expect(locales).toContain('de')
  })

  it.each(locales)(
    'AWTD-921: %s tells the user to type exactly what the server will accept',
    locale => {
      const shown = render(typeToConfirm(locale), ACCOUNT_DELETION_CONFIRMATION_PHRASE)
      expect(shown).toContain(ACCOUNT_DELETION_CONFIRMATION_PHRASE)
    },
  )

  it.each(locales)('AWTD-921: %s carries the {phrase} placeholder, not a pasted literal', locale => {
    // The structural guarantee. A locale that spells the token out passes the
    // check above today and silently fails it the next time the line is
    // retranslated — which is the whole history of this bug.
    expect(typeToConfirm(locale)).toContain('{phrase}')
  })

  it('AWTD-921: the German prompt no longer asks for MEIN KONTO LÖSCHEN', () => {
    // The specific reported symptom, named so a regression is unmistakable.
    const shown = render(typeToConfirm('de'), ACCOUNT_DELETION_CONFIRMATION_PHRASE)
    expect(shown).not.toContain('MEIN KONTO LÖSCHEN')
    expect(shown).toContain('DELETE MY ACCOUNT')
  })

  it('keeps the surrounding sentence translated — only the token is English', () => {
    // Option 1 was "keep the phrase English", NOT "give up on translating the
    // prompt". A German reader still reads a German sentence.
    expect(typeToConfirm('de')).toMatch(/Bestätigung/)
    expect(typeToConfirm('fr')).toMatch(/confirmer/)
    expect(typeToConfirm('de')).not.toEqual(typeToConfirm('en'))
  })

  it('the phrase itself is the token both delete routes compare against', () => {
    expect(ACCOUNT_DELETION_CONFIRMATION_PHRASE).toBe('DELETE MY ACCOUNT')
  })
})
