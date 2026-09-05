/**
 * What to do when a federated sign-in lands on an account whose email was never
 * verified.
 *
 * The pre-hijack (task 1a52195f): passkey registration creates a User row for
 * whatever address it is given, with `emailVerified` left null on purpose and
 * no proof that the registrant owns it. Google and Apple sign-in then look the
 * account up BY EMAIL and link onto whatever row they find. So an attacker
 * could register a passkey on victim@example.com, and when the victim later
 * signed in with Google they would land inside the attacker's row — while the
 * attacker's passkey went on authenticating as them.
 *
 * The provider is the only party here that actually proved ownership: both
 * routes require an affirmative `email_verified` before linking. The passkey
 * proved nothing. So on adoption the provider's claim wins and the
 * unproven credentials do not survive:
 *
 *  - the account is marked verified, since the provider just affirmed it, and
 *  - every passkey registered while it was unverified is revoked.
 *
 * The cost lands on a legitimate user who made a passkey account, never
 * verified the email, and later signed in with Google: they re-register the
 * passkey once, from inside their own session. No tasks, lists or comments are
 * touched. The alternative — leaving the credential in place — leaves an
 * attacker holding a working key to somebody else's account.
 */

import type { PrismaClient } from '@prisma/client'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.adopt-unverified-account')

export interface AdoptionResult {
  /** True when the account was unverified and has now been adopted. */
  adopted: boolean
  /** How many unproven passkeys were revoked. */
  revokedPasskeys: number
}

type AdoptionClient = Pick<PrismaClient, 'user' | 'authenticator'>

export async function adoptUnverifiedAccount(
  prisma: AdoptionClient,
  user: { id: string; emailVerified: Date | null },
  provider: string,
): Promise<AdoptionResult> {
  if (user.emailVerified) {
    return { adopted: false, revokedPasskeys: 0 }
  }

  const revoked = await prisma.authenticator.deleteMany({ where: { userId: user.id } })

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: new Date() },
  })

  log.warn(
    { userId: user.id, provider, revokedPasskeys: revoked.count },
    'Adopted an unverified account on federated sign-in and revoked its unproven passkeys',
  )

  return { adopted: true, revokedPasskeys: revoked.count }
}
