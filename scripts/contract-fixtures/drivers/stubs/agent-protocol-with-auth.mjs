import { NextResponse } from 'next/server'
import { ForbiddenError } from './agent-protocol-auth.mjs'

export function withAuth(_options, handler) {
  return async (request, ...args) => {
    try {
      return await handler(request, {
        userId: 'fixture-user',
        source: 'oauth',
        scopes: ['tasks:read', 'tasks:write', 'user:read', 'user:write'],
      }, ...args)
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return NextResponse.json({ error: 'Forbidden', message: error.message }, { status: 403 })
      }
      throw error
    }
  }
}
