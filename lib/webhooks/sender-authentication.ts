/**
 * Did the inbound message actually come from the address in its From header?
 * (Task 0a5b6337.)
 *
 * lib/email-to-task-service.ts resolved the acting user straight from `From`,
 * which is unauthenticated: anyone able to get a message to the inbound
 * address could act as any user. The group routing compounds it — it creates a
 * shared list and invites every recipient — and findOrCreateUserFromEmail would
 * mint a placeholder user for an address that had never proved it exists.
 *
 * Both providers publish an authentication verdict. This turns it into one
 * boolean, with the failure direction chosen deliberately: anything other than
 * an explicit pass is a fail.
 */

/** A single mechanism's verdict, as the providers report it. */
export type AuthVerdict = 'pass' | 'fail' | 'neutral' | 'softfail' | 'none' | 'temperror' | 'permerror'

export interface SenderAuthentication {
  spf?: AuthVerdict | string
  dkim?: AuthVerdict | string
  dmarc?: AuthVerdict | string
}

function isPass(verdict: string | undefined): boolean {
  // Exact match, lowercased. A substring test would accept "passed-nothing",
  // and these values come from a third party.
  return verdict?.trim().toLowerCase() === 'pass'
}

function isFail(verdict: string | undefined): boolean {
  const normalized = verdict?.trim().toLowerCase()
  return normalized === 'fail' || normalized === 'softfail'
}

/**
 * May we act as the address in the From header?
 *
 * DKIM pass is sufficient and SPF pass is sufficient, but an explicit DKIM
 * failure vetoes: DKIM survives forwarding while SPF does not, so requiring
 * both would reject a large share of legitimate forwarded mail, while ignoring
 * a DKIM failure would accept a body that was demonstrably altered or forged.
 *
 * A missing verdict is NOT a pass. That is the whole point: if a provider
 * stops sending the header, or a new provider is added that does not send one,
 * the hole must not reopen silently.
 */
export function senderIsAuthenticated(auth: SenderAuthentication | undefined): boolean {
  if (!auth) return false
  if (isFail(auth.dkim)) return false
  if (isFail(auth.dmarc)) return false
  if (isPass(auth.dkim) || isPass(auth.dmarc)) return true
  if (isPass(auth.spf) && !isFail(auth.spf)) return true
  return false
}

/** Resend reports its verdict inside the webhook payload. */
export function senderAuthFromResend(data: unknown): SenderAuthentication | undefined {
  if (!data || typeof data !== 'object') return undefined
  const record = data as Record<string, unknown>
  const auth = (record.authentication ?? record.auth) as Record<string, unknown> | undefined
  if (!auth || typeof auth !== 'object') return undefined
  return {
    spf: typeof auth.spf === 'string' ? auth.spf : undefined,
    dkim: typeof auth.dkim === 'string' ? auth.dkim : undefined,
    dmarc: typeof auth.dmarc === 'string' ? auth.dmarc : undefined,
  }
}

/** Mailgun reports its verdict in the forwarded message headers. */
export function senderAuthFromMailgun(
  get: (field: string) => string | null | undefined
): SenderAuthentication | undefined {
  const spf = get('X-Mailgun-Spf') ?? get('spf')
  const dkim = get('X-Mailgun-Dkim-Check-Result') ?? get('dkim')
  if (!spf && !dkim) return undefined
  return {
    // Mailgun writes "Pass" / "Fail" capitalised; isPass lowercases.
    spf: spf ?? undefined,
    dkim: dkim ?? undefined,
  }
}
