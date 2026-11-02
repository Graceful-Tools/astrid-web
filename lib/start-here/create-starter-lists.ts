/**
 * "Create my lists" on /starthere — the blueprint's lists, created through the
 * public v1 API with each agent as the list's default assignee.
 *
 * Kept free of React and of fetch so the e2e test and the unit test can drive
 * the exact code the button runs. Idempotent by name: a list the caller
 * already owns with a blueprint name is reused, never duplicated, so pressing
 * the button twice (or revisiting the page) is safe.
 */

import { agentEmail } from '@/lib/brand/agent-emails'
import { STARTER_LISTS, starterAgentForList, type StarterList } from './business-blueprint'

export interface StarterApi {
  getJson(path: string): Promise<{ ok: boolean; status: number; body: unknown }>
  postJson(path: string, body: object): Promise<{ ok: boolean; status: number; body: unknown }>
}

export interface StarterListResult {
  key: StarterList['key']
  id: string
  name: string
  created: boolean
  /** The agent's user id, when that agent is available to the caller. */
  defaultAssigneeId: string | null
}

interface ListRow { id: string; name: string; ownerId?: string; isVirtual?: boolean }
interface AgentRow { id: string; email: string }

function rows<T>(body: unknown, key: string): T[] {
  const value = (body as Record<string, unknown> | null)?.[key]
  return Array.isArray(value) ? (value as T[]) : []
}

/** Find already-created blueprint lists by name (case-insensitive). */
export async function findStarterLists(api: StarterApi): Promise<Partial<Record<StarterList['key'], string>>> {
  const res = await api.getJson('/api/v1/lists')
  if (!res.ok) return {}
  const lists = rows<ListRow>(res.body, 'lists').filter(l => !l.isVirtual)
  const found: Partial<Record<StarterList['key'], string>> = {}
  for (const starter of STARTER_LISTS) {
    const match = lists.find(l => l.name?.trim().toLowerCase() === starter.name.toLowerCase())
    if (match) found[starter.key] = match.id
  }
  return found
}

export async function createStarterLists(api: StarterApi): Promise<StarterListResult[]> {
  const existing = await findStarterLists(api)

  const agentsRes = await api.getJson('/api/v1/users/me/available-agents')
  const agents = agentsRes.ok ? rows<AgentRow>(agentsRes.body, 'agents') : []
  const agentIdFor = (mailbox: string) =>
    agents.find(a => a.email?.toLowerCase() === agentEmail(mailbox).toLowerCase())?.id ?? null

  const results: StarterListResult[] = []
  for (const list of STARTER_LISTS) {
    const agent = starterAgentForList(list)
    const defaultAssigneeId = agentIdFor(agent.mailbox)
    const existingId = existing[list.key]
    if (existingId) {
      results.push({ key: list.key, id: existingId, name: list.name, created: false, defaultAssigneeId })
      continue
    }
    const res = await api.postJson('/api/v1/lists', {
      name: list.name,
      description: list.description,
      privacy: 'PRIVATE',
      ...(defaultAssigneeId ? { defaultAssigneeId } : {}),
    })
    const id = (res.body as { list?: { id?: string } } | null)?.list?.id
    if (!res.ok || !id) {
      throw new Error(`Could not create the ${list.name} list (HTTP ${res.status})`)
    }
    results.push({ key: list.key, id, name: list.name, created: true, defaultAssigneeId })
  }
  return results
}
