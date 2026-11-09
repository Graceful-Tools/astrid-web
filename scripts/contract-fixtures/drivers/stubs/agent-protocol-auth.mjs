import { state } from './agent-protocol-state.mjs'

export class ForbiddenError extends Error {}

export async function requireTaskAccess() {
  if (state.claim.accessDenied) throw new ForbiddenError('Access denied to this task')
}
