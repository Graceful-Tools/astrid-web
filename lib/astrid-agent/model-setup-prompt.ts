/**
 * Astrid's "set up a model" reply — AWTD-1054, the web half of iOS AITD-451.
 *
 * Jon: "Across platforms, make sure if the user chats with Astrid, it prompts
 * the user to set an AI model if they don't have one set."
 *
 * Before this the reply was an English literal written in two places, and it
 * was reachable only through an explicit @Astrid with no key. Every other
 * "cannot answer" state was silence: an on-device model selected from a client
 * that cannot run it, a default agent that was deleted, or a selected assistant
 * with no key in a personal channel or an iOS handoff.
 *
 * The link is ROOT-RELATIVE on purpose: iOS (AITD-451) routes `/settings/agents`
 * in chat to its own Settings → Agents, and web opens the same page in-app.
 *
 * Users carry no stored locale, so the caller passes the request's
 * Accept-Language through `resolveRequestLocale`. URLSession sends the app's
 * preferred languages, so the iOS handoff is covered too.
 */

import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { ASTRID_EMAIL } from '@/lib/astrid-agent'
import { applyBrandToMessages } from '@/lib/brand/i18n-values'
import { defaultLocale, locales, type Locale } from '@/lib/i18n/config'
import { createLogger } from '@/lib/logger'

const log = createLogger('astrid-agent.model-setup-prompt')

/** Why the selected assistant cannot answer. `none` (nothing selected) is not one: it stays silent. */
export type ModelSetupReason = 'no-key' | 'on-device' | 'invalid-agent'

export const MODEL_SETTINGS_PATH = '/settings/agents'

/** Pick the best supported locale from an Accept-Language header; English when nothing matches. */
export function resolveRequestLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1 }
    })
    .filter(({ tag, q }) => tag && tag !== '*' && q > 0)
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    const exact = locales.find((l) => l.toLowerCase() === tag)
    if (exact) return exact
    // Chinese splits by script, not by language: Hant/TW/HK/MO read Traditional.
    if (tag === 'zh' || tag.startsWith('zh-')) return /-(hant|tw|hk|mo)\b/.test(tag) ? 'zh-TW' : 'zh-CN'
    const base = locales.find((l) => l === tag.split('-')[0])
    if (base) return base
  }
  return defaultLocale
}

/** The slice of a locale file this prompt reads. */
interface SetupMessages {
  userMenu: { settings: string }
  settingsPages: { aiAgents: { title: string } }
  astridAgent: { modelSetup: { noModel: string; onDeviceUnavailable: string } }
}

async function loadMessages(locale: string): Promise<SetupMessages> {
  try {
    return applyBrandToMessages((await import(`@/lib/i18n/locales/${locale}.json`)).default)
  } catch {
    return applyBrandToMessages((await import('@/lib/i18n/locales/en.json')).default)
  }
}

/** The localized prompt, with its markdown link to Settings → Agents. */
export async function getModelSetupPrompt(reason: ModelSetupReason, locale: string): Promise<string> {
  const messages = await loadMessages(locale)
  // The label reuses the page's own translated names, so it reads the way the
  // user will see it in Settings.
  const label = `${messages.userMenu.settings} > ${messages.settingsPages.aiAgents.title}`
  const copy = reason === 'on-device'
    ? messages.astridAgent.modelSetup.onDeviceUnavailable
    : messages.astridAgent.modelSetup.noModel
  return copy.replace('{settingsLink}', `[${label}](${MODEL_SETTINGS_PATH})`)
}

/**
 * Post the setup prompt into a chat channel as Astrid and broadcast it.
 *
 * `clientRequestId` is the handoff's reply key: the unique index turns a racing
 * second post into P2002, which is swallowed here exactly as a duplicate reply is.
 */
export async function postAstridModelSetupPrompt(args: {
  channelId: string
  reason: ModelSetupReason
  locale: string
  clientRequestId?: string
}): Promise<void> {
  const { channelId, reason, locale, clientRequestId } = args

  const astrid = await prisma.user.findFirst({ where: { email: ASTRID_EMAIL }, select: { id: true } })
  if (!astrid) return

  let message
  try {
    message = await prisma.chatMessage.create({
      data: {
        channelId,
        authorId: astrid.id,
        content: await getModelSetupPrompt(reason, locale),
        type: 'MARKDOWN',
        clientRequestId,
      },
      include: {
        author: { select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true } },
      },
    })
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      log.info({ channelId, clientRequestId }, 'Setup prompt already posted for this message')
      return
    }
    throw err
  }

  const { getChatChannelRecipients } = await import('@/lib/chat-access')
  const recipients = (await getChatChannelRecipients(channelId)).filter((id) => id !== astrid.id)
  if (recipients.length === 0) return

  await broadcastToUsers(recipients, {
    type: 'chat_message_created',
    timestamp: new Date().toISOString(),
    data: {
      channelId,
      message: { ...message, createdAt: message.createdAt.toISOString(), updatedAt: message.updatedAt.toISOString() },
    },
  })
}
