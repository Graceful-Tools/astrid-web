/**
 * Prisma selects for embedding a user in a response.
 *
 * The User model carries email, pendingEmail, emailVerificationToken,
 * mcpSettings (the AI-credential blob) and webhookUrl. `include: { creator:
 * true }` returns all of them, and the public task feeds did exactly that on an
 * endpoint that needs no authentication at all — leaking a token that can
 * hijack a pending email change (task 49dcf609).
 *
 * So: never `true` for a user relation. Pick one of these.
 */

/** For feeds and lists visible to people outside the account. No email. */
export const publicUserSelect = {
  id: true,
  name: true,
  image: true,
  isAIAgent: true,
} as const

/** For responses to someone already inside the account, where email is shown. */
export const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
} as const
