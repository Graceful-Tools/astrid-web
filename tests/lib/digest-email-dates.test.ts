/**
 * Digest emails speak the recipient's calendar, not the server's (AWTD-1545).
 *
 * The digest is SENT at the user's own time and its lists are built from the user's days
 * (AWTD-1453), but the email itself formatted every date with a bare toLocaleDateString — the
 * server's zone, UTC on Vercel. So an Auckland digest at 07:00 Monday (18:00 Sunday UTC) was
 * headed Sunday, and a Los Angeles user's 9am task read "Today at 5:00 PM".
 */
import { describe, expect, it } from 'vitest'
import { digestLongDate, digestShortDate, digestDueText, digestWeekRange } from '@/lib/digest-email-dates'

// Mon 9 Nov 2026 07:00 in Auckland (NZDT, UTC+13) = Sun 8 Nov 18:00 UTC = Sun 8 Nov 10:00 in LA (PST).
const NOW = new Date('2026-11-08T18:00:00Z')
const AKL = 'Pacific/Auckland'
const LA = 'America/Los_Angeles'

describe('the digest header and subject', () => {
  it("name the recipient's day", () => {
    expect(digestLongDate(NOW, AKL)).toBe('Monday, November 9, 2026')
    expect(digestLongDate(NOW, LA)).toBe('Sunday, November 8, 2026')
    expect(digestShortDate(NOW, AKL)).toBe('November 9')
  })

  it('fall back to UTC for an unknown or missing zone, never throw', () => {
    expect(digestLongDate(NOW, 'Mars/Olympus_Mons')).toBe('Sunday, November 8, 2026')
    expect(digestLongDate(NOW, undefined)).toBe('Sunday, November 8, 2026')
  })
})

describe("a timed task's due text", () => {
  it("shows the recipient's clock time and day", () => {
    // 17:00 UTC Sunday = 09:00 Sunday in LA.
    const due = new Date('2026-11-08T17:00:00Z')
    expect(digestDueText(due, { now: NOW, zone: LA })).toBe('Today at 9:00 AM')
    // The same instant is 06:00 Monday in Auckland, which is today there too.
    expect(digestDueText(due, { now: NOW, zone: AKL })).toBe('Today at 6:00 AM')
  })

  it('counts days on the recipient\'s calendar', () => {
    const due = new Date('2026-11-09T20:00:00Z') // Mon 12:00 LA; Tue 09:00 Auckland
    expect(digestDueText(due, { now: NOW, zone: LA })).toBe('Tomorrow at 12:00 PM')
    expect(digestDueText(due, { now: NOW, zone: AKL })).toBe('Tomorrow at 9:00 AM')
  })

  it('says how many days overdue, by calendar day', () => {
    const due = new Date('2026-11-06T17:00:00Z') // Fri 09:00 LA
    expect(digestDueText(due, { now: NOW, zone: LA, isOverdue: true })).toBe('Fri, Nov 6 at 9:00 AM (2 days overdue)')
  })
})

describe("an all-day task's due text", () => {
  // Stored at UTC midnight of its calendar day; it has no time.
  const monday = new Date('2026-11-09T00:00:00Z')

  it('is its calendar day, with no time, wherever the recipient is', () => {
    expect(digestDueText(monday, { now: NOW, zone: AKL, isAllDay: true })).toBe('Today')
    expect(digestDueText(monday, { now: NOW, zone: LA, isAllDay: true })).toBe('Tomorrow')
    expect(digestDueText(new Date('2026-11-12T00:00:00Z'), { now: NOW, zone: LA, isAllDay: true })).toBe('Thu, Nov 12')
  })
})

describe('the weekly range', () => {
  it("is the recipient's Sunday to Saturday", () => {
    expect(digestWeekRange(NOW, LA)).toBe('Nov 8 - Nov 14')
    expect(digestWeekRange(NOW, AKL)).toBe('Nov 8 - Nov 14')
    // Saturday evening in LA is already Sunday in Auckland: a new week there.
    const sat = new Date('2026-11-15T04:00:00Z') // Sat 20:00 LA, Sun 17:00 Auckland
    expect(digestWeekRange(sat, LA)).toBe('Nov 8 - Nov 14')
    expect(digestWeekRange(sat, AKL)).toBe('Nov 15 - Nov 21')
  })
})
