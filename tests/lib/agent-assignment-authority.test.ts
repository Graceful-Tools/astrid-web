/**
 * Task 0672b69b — who may point an AI agent at a task.
 *
 * Assigning an agent spends the list's configured user's API key and, when they
 * run Claude Code Remote, executes code on their machine. That is a bigger
 * privilege than editing a task, so it does not follow task-edit rights: only
 * owners and admins may assign an agent to a task they did not create, unless
 * the list has explicitly opted its members in.
 */

import { describe, it, expect } from 'vitest'
import { canUserAssignAgentToTask } from '@/lib/list-permissions'

const OWNER = { id: 'owner-user' }
const ADMIN = { id: 'admin-user' }
const MEMBER = { id: 'member-user' }
const VIEWER = { id: 'viewer-user' }
const STRANGER = { id: 'stranger-user' }

const list = (extra: Record<string, unknown> = {}) => ({
  id: 'list-1',
  ownerId: OWNER.id,
  listMembers: [
    { userId: ADMIN.id, role: 'admin' },
    { userId: MEMBER.id, role: 'member' },
  ],
  ...extra,
})

const OTHERS_TASK = { id: 'task-1', creatorId: 'victim-user' }
const MEMBERS_OWN_TASK = { id: 'task-2', creatorId: MEMBER.id }

describe('canUserAssignAgentToTask (task 0672b69b)', () => {
  it("refuses a plain member on someone else's task when the list has not opted in", () => {
    expect(canUserAssignAgentToTask(MEMBER, OTHERS_TASK, list())).toBe(false)
  })

  it('lets a member assign an agent to a task they created themselves', () => {
    expect(canUserAssignAgentToTask(MEMBER, MEMBERS_OWN_TASK, list())).toBe(true)
  })

  it('lets the list owner assign an agent to anyone’s task', () => {
    expect(canUserAssignAgentToTask(OWNER, OTHERS_TASK, list())).toBe(true)
  })

  it('lets a list admin assign an agent to anyone’s task', () => {
    expect(canUserAssignAgentToTask(ADMIN, OTHERS_TASK, list())).toBe(true)
  })

  it("lets a member assign on someone else's task once the list opts in", () => {
    const optedIn = list({ aiAgentsEnabled: { enabledTypes: ['claude'], allowMemberAssignment: true } })
    expect(canUserAssignAgentToTask(MEMBER, OTHERS_TASK, optedIn)).toBe(true)
  })

  it('does not let the opt-in promote a viewer', () => {
    // A viewer is someone with NO membership row on a public list —
    // getUserRoleInList deliberately reads any listMembers row as at least
    // "member", whatever its role string says.
    const publicOptedIn = list({
      privacy: 'PUBLIC',
      aiAgentsEnabled: { enabledTypes: ['claude'], allowMemberAssignment: true },
    })
    expect(canUserAssignAgentToTask(VIEWER, OTHERS_TASK, publicOptedIn)).toBe(false)
  })

  it('refuses someone with no role on the list even for a task they created', () => {
    const strangersTask = { id: 'task-3', creatorId: STRANGER.id }
    expect(canUserAssignAgentToTask(STRANGER, strangersTask, list())).toBe(false)
  })

  it('refuses a member when the task has no creator recorded', () => {
    expect(canUserAssignAgentToTask(MEMBER, { id: 'task-4', creatorId: null }, list())).toBe(false)
  })

  it('treats a task on no list at all as the creator’s own business', () => {
    expect(canUserAssignAgentToTask(MEMBER, MEMBERS_OWN_TASK, null)).toBe(true)
    expect(canUserAssignAgentToTask(MEMBER, OTHERS_TASK, null)).toBe(false)
  })
})

describe('the member-assignment opt-in survives a list edit (task 0672b69b)', () => {
  it('is carried through normalisation rather than rebuilt from the two keys the writer knows', async () => {
    const { normalizeAgentEnabledConfig } = await import('@/lib/resolve-default-agent')

    const stored = { enabledTypes: ['claude'], defaultAgentId: 'agent-1', allowMemberAssignment: true }
    expect(normalizeAgentEnabledConfig(stored).allowMemberAssignment).toBe(true)

    // The column is read back from the DB as a JSON string on some paths.
    expect(normalizeAgentEnabledConfig(JSON.stringify(stored)).allowMemberAssignment).toBe(true)
  })

  it('defaults to NOT opted in for every shape that predates the flag', async () => {
    const { normalizeAgentEnabledConfig } = await import('@/lib/resolve-default-agent')

    expect(normalizeAgentEnabledConfig(['claude']).allowMemberAssignment).toBeFalsy()
    expect(normalizeAgentEnabledConfig({ enabledTypes: ['claude'] }).allowMemberAssignment).toBe(false)
    expect(normalizeAgentEnabledConfig(null).allowMemberAssignment).toBeFalsy()
  })

  it('does not treat a truthy non-boolean as consent', async () => {
    const { normalizeAgentEnabledConfig } = await import('@/lib/resolve-default-agent')

    expect(
      normalizeAgentEnabledConfig({ enabledTypes: [], allowMemberAssignment: 'yes' })
        .allowMemberAssignment
    ).toBe(false)
    expect(canUserAssignAgentToTask(MEMBER, OTHERS_TASK, list({
      aiAgentsEnabled: { enabledTypes: [], allowMemberAssignment: 'yes' },
    }))).toBe(false)
  })
})
