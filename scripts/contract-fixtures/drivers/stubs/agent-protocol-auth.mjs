import { state } from './agent-protocol-state.mjs'

export class ForbiddenError extends Error {}
export class UnauthorizedError extends Error {}

export async function authenticateAPI() {
  return {
    userId: 'fixture-user',
    source: 'oauth',
    scopes: ['tasks:read', 'tasks:write', 'user:read', 'user:write'],
  }
}

export function requireScopes(auth, requiredScopes) {
  if (!requiredScopes.every((scope) => auth.scopes?.includes(scope) || auth.scopes?.includes('*'))) {
    throw new ForbiddenError(`Missing required scopes: ${requiredScopes.join(', ')}`)
  }
}

export async function requireTaskAccess() {
  if (state.claim.accessDenied) throw new ForbiddenError('Access denied to this task')
}
