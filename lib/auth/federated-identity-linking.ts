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
 * `linkFederatedIdentity` (NextAuth's signIn callback) returns whether the
 * sign-in may proceed; on `true` with no existing account, NextAuth creates the
 * user through the adapter. `signInWithVerifiedIdentity` (the native Apple and
 * Google routes, which have no adapter) applies the same rule and creates the
 * user itself.
 */

import { prisma } from '@/lib/prisma'
import { adoptUnverifiedAccount } from '@/lib/auth/adopt-unverified-account'
import { isBrandAgentEmail } from '@/lib/brand/agent-emails'
import { createDefaultListsForUser } from '@/lib/default-lists'
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

function accountTokens(account: FederatedSignIn['account']): Record<string, unknown> {
  const tokens: Record<string, unknown> = {}
  for (const field of ACCOUNT_TOKEN_FIELDS) if (account[field] !== undefined) tokens[field] = account[field]
  return tokens
}

/** What the rule decided, before anyone is created. */
type LinkDecision =
  | { kind: 'known'; userId: string }
  | { kind: 'linked'; userId: string }
  | { kind: 'new'; email: string }
  | { kind: 'refused'; reason: 'refused' | 'missing-email' }

/**
 * The rule itself, shared by NextAuth (which creates new users through its
 * adapter) and the native routes (which create them here). `email` may be
 * null only for an identity that is already linked: Apple sends the email on
 * the first sign-in and not reliably after.
 */
async function decideFederatedLink(signIn: Omit<FederatedSignIn, 'email'> & { email: string | null }): Promise<LinkDecision> {
  const { provider, account, profile } = signIn

  const known = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: account.providerAccountId } },
  })
  if (known) {
    // A returning user: keep their picture current, as Google sign-in always has.
    if (profile.image) await prisma.user.update({ where: { id: known.userId }, data: { image: profile.image } })
    return { kind: 'known', userId: known.userId }
  }

  if (!signIn.email) return { kind: 'refused', reason: 'missing-email' }
  const email = signIn.email.trim().toLowerCase()

  if (signIn.emailTrust === 'none') {
    log.warn({ provider }, 'Refusing federated sign-in: the provider does not vouch for the email')
    return { kind: 'refused', reason: 'refused' }
  }
  if (signIn.emailTrust === 'domain-bound' && !(signIn.allowedDomains ?? []).map(d => d.toLowerCase()).includes(domainOf(email))) {
    log.warn({ provider, domain: domainOf(email) }, 'Refusing SSO sign-in: email outside the connection’s domains')
    return { kind: 'refused', reason: 'refused' }
  }
  if (isProtectedAddress(email)) {
    log.warn({ provider }, 'Refusing federated sign-in onto a protected address')
    return { kind: 'refused', reason: 'refused' }
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (!existing) return { kind: 'new', email }
  if (existing.isAIAgent) {
    log.warn({ provider }, 'Refusing federated sign-in onto an AI agent')
    return { kind: 'refused', reason: 'refused' }
  }

  await adoptUnverifiedAccount(prisma, existing, provider)

  await prisma.account.create({
    data: { userId: existing.id, type: account.type, provider, providerAccountId: account.providerAccountId, ...accountTokens(account) },
  })

  // Fill in what the account lacks; never overwrite a name the user chose.
  const update: { name?: string; image?: string } = {}
  if (profile.name && !existing.name) update.name = profile.name
  if (profile.image) update.image = profile.image
  if (Object.keys(update).length > 0) await prisma.user.update({ where: { id: existing.id }, data: update })

  return { kind: 'linked', userId: existing.id }
}

export async function linkFederatedIdentity(signIn: FederatedSignIn): Promise<boolean> {
  return (await decideFederatedLink(signIn)).kind !== 'refused'
}

export interface SignedInUser {
  id: string
  email: string
  name: string | null
  image: string | null
}

export type VerifiedIdentitySignIn =
  | { ok: true; user: SignedInUser; created: boolean; linked: boolean }
  | { ok: false; reason: 'refused' | 'missing-email' }

/**
 * The same rule for a caller with no NextAuth adapter behind it — the native
 * Apple and Google routes (AWTD-1104) — so it also creates the user, verified
 * and with default lists, when the identity and its email are both new.
 */
export async function signInWithVerifiedIdentity(
  signIn: Omit<FederatedSignIn, 'email'> & { email: string | null },
): Promise<VerifiedIdentitySignIn> {
  const decision = await decideFederatedLink(signIn)
  if (decision.kind === 'refused') return { ok: false, reason: decision.reason }

  if (decision.kind === 'new') {
    const { provider, account, profile } = signIn
    const user = await prisma.user.create({
      data: {
        email: decision.email,
        name: profile.name || decision.email.split('@')[0],
        image: profile.image ?? null,
        emailVerified: new Date(),
        accounts: {
          create: { type: account.type, provider, providerAccountId: account.providerAccountId, ...accountTokens(account) },
        },
      },
    })
    await createDefaultListsForUser(user.id)
    return { ok: true, user: pickUser(user), created: true, linked: false }
  }

  let user = await prisma.user.findUnique({ where: { id: decision.userId } })
  if (!user) throw new Error('Linked account points at a missing user')
  // Apple gives the name only on the first authorization, client-side, so a
  // returning user can be the first chance to fill one in.
  if (decision.kind === 'known' && signIn.profile.name && !user.name) {
    user = await prisma.user.update({ where: { id: user.id }, data: { name: signIn.profile.name } })
  }
  return { ok: true, user: pickUser(user), created: false, linked: decision.kind === 'linked' }
}

function pickUser(user: { id: string; email: string; name: string | null; image: string | null }): SignedInUser {
  return { id: user.id, email: user.email, name: user.name, image: user.image }
}
