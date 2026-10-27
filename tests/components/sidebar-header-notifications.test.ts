/**
 * The notification bell lives in the sidebar's brand header, beside search (AWTD-1357).
 *
 * Jon: *"Move notifications into the list settings next to the search
 * magnifying glass."* The bell used to sit in `TaskManagerHeader`, which
 * returns null in the desktop / 3-column layout — so on desktop there was no
 * bell at all. The brand header renders in every layout (behind the hamburger
 * on mobile, alongside search), so one bell there reaches everyone.
 *
 * Pinned at the source for the reason `sidebar-header-search.test.ts` gives:
 * rendering `LeftSidebar` needs a dozen handlers to prove a thing about order.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

const sidebar = read('components/TaskManager/Sidebar/LeftSidebar.tsx')
const listHeader = read('components/TaskManager/Header/TaskManagerHeader.tsx')

const brandHeader = (() => {
  const start = sidebar.indexOf('{/* Astrid brand header */}')
  if (start === -1) throw new Error('AWTD-1357: the brand header comment is gone — re-derive this test')
  return sidebar.slice(start, sidebar.indexOf('<div className="p-3">', start))
})()

describe('notification bell placement (AWTD-1357)', () => {
  it('renders the bell in the sidebar brand header', () => {
    expect(brandHeader).toMatch(/<NotificationBell\b/)
  })

  it('puts the bell immediately before the search icon', () => {
    const bell = brandHeader.indexOf('<NotificationBell')
    const search = brandHeader.indexOf('t("search.open")')
    expect(bell).toBeGreaterThan(-1)
    expect(search).toBeGreaterThan(bell)
  })

  it('opens the popover rightward, away from the left screen edge', () => {
    expect(brandHeader).toMatch(/<NotificationBell[^>]*align="start"/)
  })

  it('no longer renders a second bell in the list header', () => {
    expect(listHeader).not.toMatch(/<NotificationBell\b/)
  })
})
