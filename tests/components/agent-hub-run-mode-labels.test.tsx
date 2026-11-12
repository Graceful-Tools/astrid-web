/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1575: the sentence above the agent list names its control —
 * "{astridRuns} needs that provider's API key. {selfRuns} uses the coding tool
 * you already pay for" — and was translated, while the control itself still
 * said "I run it". A German reader was told to pick "Ich führe ihn aus" and
 * given a button that says something else.
 *
 * The two must be one string per locale, so the control is rendered in every
 * locale and compared with what the sentence is filled with.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { AgentHub } from '@/components/agent-hub'
import { applyBrandToMessages } from '@/lib/brand/i18n-values'

// tests/setup.ts answers every key in English; this is about each locale's own words.
vi.unmock('@/lib/i18n/client')

vi.mock('@/lib/brand/capabilities', () => ({ CAPABILITIES: { integrationMcp: true } }))
vi.mock('@/components/webhook-settings-manager', () => ({ WebhookSettingsManager: () => null }))
vi.mock('@/components/custom-agent-manager', () => ({ CustomAgentManager: () => null }))
vi.mock('@/components/github-copilot-mcp-setup', () => ({ GitHubCopilotMcpSetup: () => null }))
vi.mock('@/lib/api', () => ({ apiPut: vi.fn(), apiPost: vi.fn(), apiCall: vi.fn() }))

const LOCALES_DIR = join(process.cwd(), 'lib/i18n/locales')
const LOCALES = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => basename(file, '.json'))

type YourAgents = { description: string; astridRuns: string; selfRuns: string }

function messagesFor(locale: string) {
  return applyBrandToMessages(JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')))
}

describe('the run-mode control says what the sentence above it calls it (AWTD-1575)', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string | URL | Request) => {
      const body = String(url).includes('/agent-modes')
        ? { modes: { claude: 'polling', openai: 'polling', copilot: 'polling', gemini: 'polling', codex: 'polling' } }
        : {}
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
    }) as typeof fetch
  })

  it('finds the locale files', () => {
    expect(LOCALES).toContain('en')
    expect(LOCALES.length).toBeGreaterThanOrEqual(12)
  })

  it('fills the sentence from the two keys the control is compared with', () => {
    const page = readFileSync(join(process.cwd(), 'components/Settings/AgentsSettings.tsx'), 'utf8')
    expect(page).toMatch(/astridRuns:\s*<strong>\{t\("settingsPages\.aiAgents\.yourAgents\.astridRuns"\)\}<\/strong>/)
    expect(page).toMatch(/selfRuns:\s*<strong>\{t\("settingsPages\.aiAgents\.yourAgents\.selfRuns"\)\}<\/strong>/)
  })

  it.each(LOCALES)('%s', async (locale) => {
    const messages = messagesFor(locale)
    const named: YourAgents = messages.settingsPages.aiAgents.yourAgents
    expect(named.description).toContain('{astridRuns}')
    expect(named.description).toContain('{selfRuns}')

    const { unmount } = render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <AgentHub />
      </NextIntlClientProvider>,
    )
    await screen.findByText('Gemini')

    // The run-mode buttons are the pressable ones; every row offers "I run it",
    // and the rows Astrid can execute offer "Astrid runs it" too.
    const labels = screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed')).map((button) => button.textContent)
    expect(labels).toContain(named.selfRuns)
    expect(labels).toContain(named.astridRuns)
    // Nothing on the control is left in English where the locale has its own word.
    if (locale !== 'en') {
      expect(labels).not.toContain('I run it')
      expect(labels).not.toContain('Off')
    }
    unmount()
  })
})
