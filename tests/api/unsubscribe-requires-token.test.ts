/**
 * Task e0613ae5 — `/api/settings/reminders/unsubscribe` must not act on a bare
 * user id.
 *
 * It previously did: `?userId=<anyone>` disabled that user's email reminders,
 * unauthenticated. User ids are not secret — they come back as task creators,
 * assignees, list members and comment authors — so this was a silent, targeted
 * denial of a feature the user is paying attention to.
 *
 * The accidental case matters as much as the malicious one: this is a GET with
 * a side effect, so an email client, security scanner or chat link preview
 * that merely FETCHES the link unsubscribes the recipient.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminderSettings: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

import { GET, POST } from '@/app/api/settings/reminders/unsubscribe/route'
import { prisma } from '@/lib/prisma'
import { createUnsubscribeToken } from '@/lib/unsubscribe-token'

const mockPrisma = vi.mocked(prisma)
const ORIGINAL = process.env.NEXTAUTH_SECRET
const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = 'test-secret'
  mockPrisma.reminderSettings.findUnique.mockResolvedValue({ userId: USER } as never)
  mockPrisma.reminderSettings.update.mockResolvedValue({} as never)
})
afterEach(() => { process.env.NEXTAUTH_SECRET = ORIGINAL })

function get(qs: string) {
  return GET(new NextRequest(`http://localhost/api/settings/reminders/unsubscribe?${qs}`))
}

describe('unsubscribe requires a signed link (task e0613ae5)', () => {
  it('refuses a bare userId — the vulnerability', async () => {
    const res = await get(`userId=${USER}`)

    expect(res.status).toBe(403)
    expect(mockPrisma.reminderSettings.update).not.toHaveBeenCalled()
  })

  it("refuses another user's token", async () => {
    const res = await get(`userId=${USER}&token=${createUnsubscribeToken('someone-else')}`)

    expect(res.status).toBe(403)
    expect(mockPrisma.reminderSettings.update).not.toHaveBeenCalled()
  })

  it('honours a properly signed link', async () => {
    // The feature still has to work — an unsubscribe link that fails is how
    // you get marked as spam.
    const res = await get(`userId=${USER}&token=${createUnsubscribeToken(USER)}`)

    expect(res.status).toBe(200)
    expect(mockPrisma.reminderSettings.update).toHaveBeenCalledWith({
      where: { userId: USER },
      data: { enableEmailReminders: false },
    })
  })

  it('applies the same rule to POST', async () => {
    const bad = await POST(new NextRequest('http://localhost/api/settings/reminders/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ userId: USER }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(bad.status).toBe(403)
    expect(mockPrisma.reminderSettings.update).not.toHaveBeenCalled()

    const good = await POST(new NextRequest('http://localhost/api/settings/reminders/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ userId: USER, token: createUnsubscribeToken(USER) }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(good.status).toBe(200)
    expect(mockPrisma.reminderSettings.update).toHaveBeenCalled()
  })
})
