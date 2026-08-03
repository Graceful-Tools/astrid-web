import { describe, expect, it } from 'vitest'
import {
  getPriorityColor,
  taskLeadingControlKind,
} from '@/lib/task-leading-control'

/**
 * The leading control answers "whose task is this?" and it has THREE answers,
 * not two (task 2bb1b196, companion to iOS/Mac 42013da7). Unassigned had been
 * folded in with "mine", so a task nobody owns looked exactly like a task you
 * own — two different states rendering identically.
 *
 * iOS keeps the decision in one pure function so the row, the detail and quick
 * add cannot disagree about the same task. This is the web mirror of it.
 */
describe('taskLeadingControlKind (task 2bb1b196)', () => {
  it('shows the assignee avatar when the task belongs to someone else', () => {
    expect(taskLeadingControlKind({ assigneeId: 'other', currentUserId: 'me' }))
      .toBe('avatar')
  })

  it('shows the completion checkbox when the task is yours', () => {
    expect(taskLeadingControlKind({ assigneeId: 'me', currentUserId: 'me' }))
      .toBe('checkbox')
  })

  it('shows the unassigned mark when nobody owns the task', () => {
    expect(taskLeadingControlKind({ assigneeId: null, currentUserId: 'me' }))
      .toBe('unassigned')
  })

  it('treats undefined assignee the same as null — still nobody owns it', () => {
    expect(taskLeadingControlKind({ assigneeId: undefined, currentUserId: 'me' }))
      .toBe('unassigned')
  })

  it('keeps a completed unassigned task on the checkbox so its done state is legible', () => {
    // The mark has to be able to read as checked. "U" cannot, and a completed
    // task must still show that it is completed.
    expect(taskLeadingControlKind({ assigneeId: null, currentUserId: 'me', completed: true }))
      .toBe('checkbox')
  })

  it('still shows the avatar for a completed task owned by someone else', () => {
    expect(taskLeadingControlKind({ assigneeId: 'other', currentUserId: 'me', completed: true }))
      .toBe('avatar')
  })

  it('shows the unassigned mark when there is no signed-in user to compare against', () => {
    expect(taskLeadingControlKind({ assigneeId: null, currentUserId: undefined }))
      .toBe('unassigned')
  })

  it('shows the avatar for an assigned task when the viewer is anonymous', () => {
    // A signed-out viewer owns nothing, so an assigned task is someone else's.
    expect(taskLeadingControlKind({ assigneeId: 'other', currentUserId: undefined }))
      .toBe('avatar')
  })
})

describe('getPriorityColor (task 2bb1b196)', () => {
  it('maps each priority to the colour every call site was already using', () => {
    expect(getPriorityColor(3)).toBe('rgb(239, 68, 68)')
    expect(getPriorityColor(2)).toBe('rgb(251, 191, 36)')
    expect(getPriorityColor(1)).toBe('rgb(59, 130, 246)')
    expect(getPriorityColor(0)).toBe('rgb(107, 114, 128)')
  })

  it('falls back to the no-priority grey for out-of-range values', () => {
    expect(getPriorityColor(-1)).toBe('rgb(107, 114, 128)')
    expect(getPriorityColor(99)).toBe('rgb(107, 114, 128)')
  })
})
