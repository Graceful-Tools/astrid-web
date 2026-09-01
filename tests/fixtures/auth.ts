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
    },
    source: 'session',
    scopes: [],
    ...overrides,
  }
}
