/**
 * AWTD-1188: the one "may this person put a task on these lists?" rule, taken
 * out of services/task.service.ts so the create and update paths share it.
 *
 * Pinned:
 *   - the owner and members may; a stranger may not, and is told which list;
 *   - anyone may add to a collaborative public list;
 *   - a GitHub label list asks for nothing, carried already or not: it is
 *     read-only from Astrid for everyone, and the label guard refuses it by
 *     name afterwards (AWTD-1193). Deciding a role here could only change
 *     WHICH error a doomed write gets;
 *   - a label list that mirrors no GitHub label is an ordinary list.
 */

import { describe, it, expect } from 'vitest'
import { listRefusingTask } from '@/lib/list-add-permission'

const list = (id: string, over: object = {}) => ({
  id,
  ownerId: 'owner',
  privacy: 'PRIVATE',
  publicListType: null as string | null,
  listType: 'regular',
  remoteNodeId: null as string | null,
  listMembers: [{ userId: 'member', role: 'member' }],
  ...over,
})

describe('listRefusingTask (AWTD-1188)', () => {
  it('lets the owner and a member add, and names the list a stranger may not add to', () => {
    const lists = [list('a'), list('b', { listMembers: [] })]
    expect(listRefusingTask(lists, 'owner')).toBeUndefined()
    expect(listRefusingTask(lists, 'member')?.id).toBe('b')
    expect(listRefusingTask(lists, 'stranger')?.id).toBe('a')
  })

  it('lets anyone add to a collaborative public list, and no other public list', () => {
    expect(listRefusingTask([list('open', { privacy: 'PUBLIC', publicListType: 'collaborative' })], 'stranger')).toBeUndefined()
    expect(listRefusingTask([list('copy', { privacy: 'PUBLIC', publicListType: 'copy_only' })], 'stranger')?.id).toBe('copy')
  })

  it('a GitHub label the task already carries asks for nothing', () => {
    const label = list('label-bug', { listType: 'label', remoteNodeId: 'LA_bug', listMembers: [] })
    const board = list('board')
    expect(listRefusingTask([board, label], 'member')).toBeUndefined()
  })

  it('nor does one the task does NOT carry — the label guard names that refusal (AWTD-1193)', () => {
    // This used to be refused here with a bare 403 naming the list, which a
    // board member could not even open. Adding a GitHub label is impossible
    // for everyone, owner included, so there is one answer to give and the
    // guard gives it: 400 github_label_read_only.
    const label = list('label-bug', { listType: 'label', remoteNodeId: 'LA_bug', listMembers: [] })
    expect(listRefusingTask([label], 'member')).toBeUndefined()
    expect(listRefusingTask([label], 'stranger')).toBeUndefined()
  })

  it('a label list mirroring no GitHub label is an ordinary list', () => {
    // Converted from someone's own regular list: it has no remoteNodeId, and a
    // stranger may not add to it.
    const mine = list('mine', { listType: 'label', remoteNodeId: null, listMembers: [] })
    expect(listRefusingTask([mine], 'stranger')?.id).toBe('mine')
    expect(listRefusingTask([mine], 'owner')).toBeUndefined()
  })
})
