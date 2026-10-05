/**
 * The linking rule every federated sign-in shares (spec §6.3).
 *
 * Signing in with a provider identity Astrid has not seen before either creates
 * a user or links onto the existing account with that email. Linking by email
 * is the account-takeover surface, and every provider added widens it — Google
 * on web used to link on any email at all (AWTD-1088). So:
 *
 *   1. An identity already linked signs in as its user. Nothing else happens.
 *   2. The email must be one the provider vouches for:
 *        - 'verified'      the provider affirmed it (Google's email_verified,
 *                          GitHub's verified primary from /user/emails);
 *        - 'domain-bound'  an SSO IdP, trusted only for its configured domains
 *                          — an IdP admin can assert any address at all;
 *        - 'none'          refused, new user or not. Refusing outright is what
 *                          lets the adapter start every OAuth-created user
 *                          verified.
 *   3. Never onto an AI agent, an address at the agent domain, or the initial
 *      admin — whatever a domain list says.
 *   4. Linking adopts the account first: credentials registered while the
 *      address was unproven (a pre-hijacking passkey) do not survive (1a52195f).
 *
 * Returns whether the sign-in may proceed. On `true` with no existing account,
 * NextAuth creates the user through the adapter.
 */

import { prisma } from '@/lib/prisma'
import { adoptUnverifiedAccount } from '@/lib/auth/adopt-unverified-account'
import { isBrandAgentEmail } from '@/lib/brand/agent-emails'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.federated-linking')

export type EmailTrust = 'verified' | 'domain-bound' | 'none'

export interface FederatedSignIn {
  provider: string
  /** The NextAuth account: provider, type, providerAccountId and any tokens. */
  account: { provider: string; type: string; providerAccountId: string } & Record<string, unknown>
  email: string
  emailTrust: EmailTrust
  /** For 'domain-bound': the domains this connection may vouch for. */
  allowedDomains?: readonly string[]
  profile: { name?: string | null; image?: string | null }
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase()
}

function isProtectedAddress(email: string): boolean {
  const initialAdmin = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase()
  return isBrandAgentEmail(email) || (!!initialAdmin && email === initialAdmin)
}

const ACCOUNT_TOKEN_FIELDS = [
  'refresh_token', 'access_token', 'expires_at', 'token_type', 'scope', 'id_token', 'session_state',
] as const

export async function linkFederatedIdentity(signIn: FederatedSignIn): Promise<boolean> {
  const { provider, account, profile } = signIn
  const email = signIn.email.trim().toLowerCase()

  const known = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: account.providerAccountId } },
  })
  if (known) {
    // A returning user: keep their picture current, as Google sign-in always has.
    if (profile.image) await prisma.user.update({ where: { id: known.userId }, data: { image: profile.image } })
    return true
  }

  if (signIn.emailTrust === 'none') {
    log.warn({ provider }, 'Refusing federated sign-in: the provider does not vouch for the email')
    return false
  }
  if (signIn.emailTrust === 'domain-bound' && !(signIn.allowedDomains ?? []).map(d => d.toLowerCase()).includes(domainOf(email))) {
    log.warn({ provider, domain: domainOf(email) }, 'Refusing SSO sign-in: email outside the connection’s domains')
    return false
  }
  if (isProtectedAddress(email)) {
    log.warn({ provider }, 'Refusing federated sign-in onto a protected address')
    return false
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (!existing) return true
  if (existing.isAIAgent) {
    log.warn({ provider }, 'Refusing federated sign-in onto an AI agent')
    return false
  }

  await adoptUnverifiedAccount(prisma, existing, provider)

  const tokens: Record<string, unknown> = {}
  for (const field of ACCOUNT_TOKEN_FIELDS) if (account[field] !== undefined) tokens[field] = account[field]
  await prisma.account.create({
    data: { userId: existing.id, type: account.type, provider, providerAccountId: account.providerAccountId, ...tokens },
  })

  // Fill in what the account lacks; never overwrite a name the user chose.
  const update: { name?: string; image?: string } = {}
  if (profile.name && !existing.name) update.name = profile.name
  if (profile.image) update.image = profile.image
  if (Object.keys(update).length > 0) await prisma.user.update({ where: { id: existing.id }, data: update })

  return true
}
