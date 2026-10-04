/**
 * AWTD-1073, second half: the same unescaped interpolation the reminder emails had was in
 * the invitation and verification emails — and those go to OTHER people. An inviter's
 * display name, a list name or an invitation message is typed by one user and rendered as
 * HTML in another user's inbox, from Astrid's own domain.
 *
 * Driven through the real send functions with the transport captured, so the assertion is
 * on the HTML that would actually be sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sent: Array<{ html?: string; text?: string; subject?: string }> = []

vi.mock('@/lib/email-transport', () => ({
  isEmailTransportLive: () => true,
  sendTransportEmail: vi.fn(async (email: { html?: string; text?: string; subject?: string }) => {
    sent.push(email)
    return { id: 'test' }
  }),
}))

const HOSTILE = `<a href="https://evil.example">x</a><img src=x onerror=alert(1)>`

function lastHtml(): string {
  const html = sent.at(-1)?.html
  expect(html, 'an email was sent with an HTML body').toBeTruthy()
  return html as string
}

function expectEscaped(html: string) {
  expect(html).not.toContain('<img src=x')
  expect(html).not.toContain('<a href="https://evil.example">')
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
}

describe('invitation and verification emails escape user-typed text (AWTD-1073)', () => {
  beforeEach(() => {
    sent.length = 0
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('list invitation: inviter name, list name and message', async () => {
    const { sendListInvitationEmail } = await import('@/lib/email')
    await sendListInvitationEmail({
      to: 'friend@example.com',
      inviterName: HOSTILE,
      listName: HOSTILE,
      role: 'member',
      invitationUrl: 'https://example.com/invite/abc',
      message: HOSTILE,
    })
    const html = lastHtml()
    expectEscaped(html)
    // Three separate places, all escaped — not one lucky one.
    expect(html.split('&lt;img src=x onerror=alert(1)&gt;').length - 1).toBeGreaterThanOrEqual(3)
  })

  it('workspace invitation: sender name and message', async () => {
    const { sendInvitationEmail } = await import('@/lib/email')
    await sendInvitationEmail({
      id: 'i1',
      email: 'friend@example.com',
      token: 't1',
      type: 'WORKSPACE',
      expiresAt: new Date(Date.now() + 86_400_000),
      sender: { name: HOSTILE, email: 'sender@example.com' },
      message: HOSTILE,
    })
    expectEscaped(lastHtml())
  })

  it('verification email: the user name and both addresses on an email change', async () => {
    const { sendVerificationEmail } = await import('@/lib/email')
    await sendVerificationEmail({
      email: `"><img src=x onerror=alert(1)>@example.com`,
      token: 't2',
      userName: HOSTILE,
      isEmailChange: true,
      currentEmail: `<img src=x onerror=alert(1)>@example.com`,
    })
    expectEscaped(lastHtml())
  })
})
