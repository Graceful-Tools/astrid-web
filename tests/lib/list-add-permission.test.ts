/**
 * AWTD-1188: the one "may this person put a task on these lists?" rule, taken
 * out of services/task.service.ts so the create and update paths share it.
 *
 * Pinned:
 *   - the owner and members may; a stranger may not, and is told which list;
 *   - anyone may add to a collaborative public list;
 *   - a GitHub label the task already carries is kept, not added: a board
 *     member who is not on the label's list can still move the task;
 *   - a GitHub label the task does NOT carry gets no such pass.
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
    expect(listRefusingTask([board, label], 'member', [{ id: 'board' }, { id: 'label-bug' }])).toBeUndefined()
  })

  it('a GitHub label the task does not carry is an add like any other', () => {
    const label = list('label-bug', { listType: 'label', remoteNodeId: 'LA_bug', listMembers: [] })
    expect(listRefusingTask([label], 'member', [{ id: 'board' }])?.id).toBe('label-bug')
    expect(listRefusingTask([label], 'member')?.id).toBe('label-bug')
  })
})
