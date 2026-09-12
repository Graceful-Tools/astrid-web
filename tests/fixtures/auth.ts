import type { AuthContext } from '@/lib/api-auth-middleware'

let sequence = 0

export function buildAuthContext(
  overrides: Partial<AuthContext> = {}
): AuthContext {
  sequence += 1
  const userId = overrides.userId ?? `risk-user-${sequence}`
  return {
    userId,
    user: {
      id: userId,
      email: `risk-${sequence}@example.test`,
      name: `Risk user ${sequence}`,
      // Required by AuthContext. The fixture omitted it and nothing compiled
      // the test tree to say so (AWTD-916), so every caller was building an
      // AuthContext that does not typecheck.
      isAIAgent: false,
    },
    source: 'session',
    scopes: [],
    // Also required at the top level, and also never set. Route code branches
    // on it, so every fixture-built context was reaching that branch as
    // `undefined` rather than as the `false` it means (AWTD-916).
    isAIAgent: false,
    ...overrides,
  }
}
