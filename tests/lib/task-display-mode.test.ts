/**
 * The task display mode setting (task ffa5bbb5).
 *
 * Jon: "Create the mode toggle in the database and expose in appearance. Then
 * set all users and new users to list mode by default."
 *
 * The default is the part worth pinning hardest. "All users" includes rows
 * written before the column existed, which read back as null — so the default
 * has to hold in the normalizer as well as in the schema, or existing accounts
 * would land somewhere undefined while new ones landed on list.
 *
 * The endpoint cases below cover BOTH surfaces on purpose. iOS uses /api/v1/*
 * and /api/* and they are not duplicates; a preference that only one of them
 * carries is a setting that appears to reset itself depending on which screen
 * last wrote it. subtaskDisplay had exactly that gap (task 641a7615).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  TASK_DISPLAY_MODES,
  DEFAULT_TASK_DISPLAY_MODE,
  normalizeTaskDisplayMode,
  isTaskDisplayMode,
  usesCompactTaskDetail,
  checkboxCompletesTask,
} from '@/lib/task-display-mode'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('the two modes (task ffa5bbb5)', () => {
  it('is exactly list and project', () => {
    expect([...TASK_DISPLAY_MODES]).toEqual(['list', 'project'])
  })

  it('defaults to list', () => {
    expect(DEFAULT_TASK_DISPLAY_MODE).toBe('list')
  })

  it.each([null, undefined, '', 'projectt', 'LIST', 42, {}])(
    'normalizes %o to list rather than throwing',
    value => {
      // Rows written before the column read back null; a client may send
      // anything. Reading a preference must never be an error page.
      expect(normalizeTaskDisplayMode(value)).toBe('list')
    },
  )

  it('keeps a real choice', () => {
    expect(normalizeTaskDisplayMode('project')).toBe('project')
    expect(normalizeTaskDisplayMode('list')).toBe('list')
  })

  it('rejects rather than coerces on the write path', () => {
    // The asymmetry with normalize is the point: a client sending `projectt`
    // should learn it was wrong, not have it silently stored as `list`.
    expect(isTaskDisplayMode('projectt')).toBe(false)
    expect(isTaskDisplayMode(null)).toBe(false)
    expect(isTaskDisplayMode('project')).toBe(true)
  })
})

describe('what each mode means for the UI (task ffa5bbb5)', () => {
  it('list mode completes on the checkbox and does not compact', () => {
    expect(checkboxCompletesTask('list')).toBe(true)
    expect(usesCompactTaskDetail('list')).toBe(false)
  })

  it('project mode compacts and moves completion into the popover', () => {
    expect(usesCompactTaskDetail('project')).toBe(true)
    expect(checkboxCompletesTask('project')).toBe(false)
  })

  it('an unset preference behaves as list on both questions', () => {
    expect(checkboxCompletesTask(null)).toBe(true)
    expect(usesCompactTaskDetail(null)).toBe(false)
  })
})

describe('the column and both settings surfaces carry it (task ffa5bbb5)', () => {
  it('User.taskDisplayMode exists and defaults to list in the schema', () => {
    const schema = read('prisma/schema.prisma')
    expect(schema).toMatch(/taskDisplayMode\s+String\?\s+@default\("list"\)/)
  })

  it.each([
    'app/api/v1/users/me/smart-tasks/route.ts',
    'app/api/user/settings/route.ts',
  ])('%s reads and writes taskDisplayMode', file => {
    const src = read(file)
    expect(src, 'not selected, so the client never learns the stored value').toMatch(
      /taskDisplayMode:\s*true/,
    )
    expect(src, 'not writable, so the Appearance toggle would not persist').toMatch(
      /'taskDisplayMode'/,
    )
  })

  it.each([
    'app/api/v1/users/me/smart-tasks/route.ts',
    'app/api/user/settings/route.ts',
  ])('%s validates the value through the shared helper', file => {
    // Not an inline ['list','project'] check: two surfaces spelling the
    // allowed set separately is how they drift apart.
    expect(read(file)).toMatch(/isTaskDisplayMode/)
  })
})
