/**
 * AWTD-1054 — Astrid's "set up a model" reply, the web half of iOS AITD-451.
 *
 * Jon: "Across platforms, make sure if the user chats with Astrid, it prompts
 * the user to set an AI model if they don't have one set."
 *
 * The reply was an English literal in two places, and it was only reachable
 * through an explicit @Astrid with no key. These pin the copy (localized, the
 * link intact in every language) and the resolver reasons that let the chat
 * paths tell "nothing configured" from "configured but cannot run".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync } from 'node:fs'
import { join, basename } from 'node:path'

const userFindUnique = vi.hoisted(() => vi.fn())
const userFindFirst = vi.hoisted(() => vi.fn())
const taskListFindUnique = vi.hoisted(() => vi.fn())
const chatMessageCreate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique, findFirst: userFindFirst },
    taskList: { findUnique: taskListFindUnique },
    chatMessage: { create: chatMessageCreate },
  },
}))

const hasValidApiKey = vi.hoisted(() => vi.fn())
const getPreferredAIService = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-key-cache', () => ({ hasValidApiKey, getPreferredAIService }))

const broadcastToUsers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))

const getChatChannelRecipients = vi.hoisted(() => vi.fn())
vi.mock('@/lib/chat-access', () => ({ getChatChannelRecipients }))

const { BRAND } = await vi.hoisted(async () => await import('@/lib/brand/config'))
const ASTRID = `astrid@${BRAND.agentEmailDomain}`
vi.mock('@/lib/astrid-agent', () => ({ ASTRID_EMAIL: `astrid@${BRAND.agentEmailDomain}` }))

import {
  getModelSetupPrompt,
  postAstridModelSetupPrompt,
  resolveRequestLocale,
  MODEL_SETTINGS_PATH,
} from '@/lib/astrid-agent/model-setup-prompt'
import { resolveDefaultAgentWithReason, resolveDefaultAgent } from '@/lib/resolve-default-agent'

const LOCALES = readdirSync(join(process.cwd(), 'lib/i18n/locales'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => basename(f, '.json'))

beforeEach(() => {
  vi.clearAllMocks()
  getPreferredAIService.mockResolvedValue('claude')
  hasValidApiKey.mockResolvedValue(false)
  taskListFindUnique.mockResolvedValue(null)
})

describe('setup prompt copy (AWTD-1054)', () => {
  it('links to Settings → Agents with a ROOT-RELATIVE path, which iOS AITD-451 routes in-app', () => {
    expect(MODEL_SETTINGS_PATH).toBe('/settings/agents')
  })

  it.each(LOCALES)('%s: both variants keep the markdown link through translation', async (locale) => {
    for (const reason of ['no-key', 'on-device', 'invalid-agent'] as const) {
      const text = await getModelSetupPrompt(reason, locale)
      expect(text).toMatch(/\[[^\]]+\]\(\/settings\/agents\)/)
      // An unsubstituted token would ship as literal braces in the chat bubble.
      expect(text).not.toMatch(/\{[a-zA-Z]+\}/)
    }
  })

  it('is localized, not the English literal', async () => {
    const en = await getModelSetupPrompt('no-key', 'en')
    const fr = await getModelSetupPrompt('no-key', 'fr')
    expect(fr).not.toBe(en)
    expect(fr).toContain('Paramètres')
  })

  it('tells an on-device user WHY it cannot answer here, rather than the generic copy', async () => {
    const generic = await getModelSetupPrompt('no-key', 'en')
    const onDevice = await getModelSetupPrompt('on-device', 'en')
    expect(onDevice).not.toBe(generic)
    expect(onDevice).toMatch(/Apple/)
  })

  it('falls back to English for an unknown locale', async () => {
    expect(await getModelSetupPrompt('no-key', 'xx')).toBe(await getModelSetupPrompt('no-key', 'en'))
  })
})

describe('resolveRequestLocale (AWTD-1054)', () => {
  it.each([
    [null, 'en'],
    ['', 'en'],
    ['fr-FR,fr;q=0.9,en;q=0.8', 'fr'],
    ['en;q=0.5, de;q=0.9', 'de'],
    ['zh-TW', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['zh-Hans', 'zh-CN'],
    ['pt-BR', 'pt'],
    ['xx-YY, *', 'en'],
  ])('%s → %s', (header, expected) => {
    expect(resolveRequestLocale(header)).toBe(expected)
  })
})

describe('resolveDefaultAgentWithReason (AWTD-1054)', () => {
  function settings(defaultAgentId: string | null) {
    userFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === 'user-1') return Promise.resolve({ aiAssistantSettings: JSON.stringify({ defaultAgentId }) })
      if (where.id === 'astrid-id') return Promise.resolve({ id: 'astrid-id', isAIAgent: true, email: ASTRID })
      return Promise.resolve(null)
    })
  }

  it('says "none" when nobody picked an assistant — the one state that stays silent', async () => {
    settings(null)
    expect(await resolveDefaultAgentWithReason(null, 'user-1')).toEqual({ agentId: null, reason: 'none' })
  })

  it('says "on-device" for Apple Foundation Models, which the server cannot run', async () => {
    settings('apple-foundation-model')
    expect(await resolveDefaultAgentWithReason(null, 'user-1')).toEqual({ agentId: null, reason: 'on-device' })
  })

  it('says "invalid-agent" for a default pointing at a deleted agent', async () => {
    settings('deleted-agent')
    expect(await resolveDefaultAgentWithReason(null, 'user-1')).toEqual({ agentId: null, reason: 'invalid-agent' })
  })

  it('says "no-key" for Astrid with no credential for the preferred service', async () => {
    settings('astrid-id')
    expect(await resolveDefaultAgentWithReason(null, 'user-1')).toEqual({ agentId: null, reason: 'no-key' })
  })

  it('resolves the agent when it can run, and resolveDefaultAgent keeps its old shape', async () => {
    settings('astrid-id')
    hasValidApiKey.mockResolvedValue(true)
    expect(await resolveDefaultAgentWithReason(null, 'user-1')).toEqual({ agentId: 'astrid-id' })
    expect(await resolveDefaultAgent(null, 'user-1')).toBe('astrid-id')
  })
})

describe('postAstridModelSetupPrompt (AWTD-1054)', () => {
  beforeEach(() => {
    userFindFirst.mockResolvedValue({ id: 'astrid-id' })
    getChatChannelRecipients.mockResolvedValue(['user-1', 'astrid-id'])
    const now = new Date('2026-10-02T00:00:00Z')
    chatMessageCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'm1', ...data, createdAt: now, updatedAt: now })
    )
  })

  it('posts the localized prompt as Astrid and broadcasts it to everyone but Astrid', async () => {
    await postAstridModelSetupPrompt({ channelId: 'channel-1', reason: 'no-key', locale: 'de' })

    const data = chatMessageCreate.mock.calls[0][0].data
    expect(data).toMatchObject({ channelId: 'channel-1', authorId: 'astrid-id', type: 'MARKDOWN' })
    expect(data.content).toBe(await getModelSetupPrompt('no-key', 'de'))
    expect(broadcastToUsers).toHaveBeenCalledWith(
      ['user-1'],
      expect.objectContaining({ type: 'chat_message_created' })
    )
  })

  it('carries the handoff idempotency key, and a duplicate insert is swallowed', async () => {
    chatMessageCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))

    await expect(
      postAstridModelSetupPrompt({ channelId: 'channel-1', reason: 'no-key', locale: 'en', clientRequestId: 'astrid-reply:msg-1' })
    ).resolves.toBeUndefined()
    expect(chatMessageCreate.mock.calls[0][0].data.clientRequestId).toBe('astrid-reply:msg-1')
    expect(broadcastToUsers).not.toHaveBeenCalled()
  })
})
