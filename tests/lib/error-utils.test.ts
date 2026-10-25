/**
 * AWTD-1342: lib/error-utils.ts had no test.
 *
 * Pinned — createErrorResponse never leaks details unless asked:
 *   - by default (the production call) the body is the generic message, with no
 *     `details`, whatever the error holds: message, stack, Prisma `meta`,
 *     connection strings;
 *   - only a string `code` (e.g. a Prisma P-code) passes through;
 *   - includeDetails=true is the only way the message reaches the body.
 * Plus the message/stack/code extractors it is built on.
 *
 * Note: createErrorResponse has no callers in app/, lib/ or services/ today.
 */

import { describe, it, expect } from 'vitest'
import {
  createErrorResponse,
  getErrorMessage,
  getErrorStack,
  getPrismaErrorCode,
  hasErrorCode,
} from '@/lib/error-utils'

const SECRET = 'postgresql://admin:hunter2@db.internal:5432/prod'

function prismaError() {
  return Object.assign(new Error(`Can't reach database server at ${SECRET}`), {
    code: 'P1001',
    meta: { database_host: 'db.internal', target: ['email'] },
    clientVersion: '6.0.0',
  })
}

describe('createErrorResponse (AWTD-1342)', () => {
  it('by default returns only the generic message — no details, message or stack', () => {
    const body = createErrorResponse(new Error(`boom at ${SECRET}`))
    expect(body).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(body)).not.toContain('hunter2')
  })

  it('a Prisma error leaks only its code, never its message or meta', () => {
    const body = createErrorResponse(prismaError())
    expect(body).toEqual({ error: 'Internal server error', code: 'P1001' })
    const wire = JSON.stringify(body)
    expect(wire).not.toContain('hunter2')
    expect(wire).not.toContain('db.internal')
    expect(wire).not.toContain('email')
  })

  it.each([
    ['a thrown string', SECRET],
    ['a plain object with a message', { message: SECRET }],
    ['null', null],
    ['an error with a non-string code', Object.assign(new Error(SECRET), { code: 42 })],
  ])('%s yields the generic body', (_label, thrown) => {
    expect(createErrorResponse(thrown)).toEqual({ error: 'Internal server error' })
  })

  it('includeDetails=false explicitly is the same as the default', () => {
    expect(createErrorResponse(prismaError(), false)).toEqual(createErrorResponse(prismaError()))
  })

  it('includeDetails=true puts the message in error and details (development only)', () => {
    expect(createErrorResponse(new Error('bad input'), true)).toEqual({ error: 'bad input', details: 'bad input' })
  })
})

describe('error extractors (AWTD-1342)', () => {
  it('getErrorMessage reads Errors, strings, message-bearing objects, and anything else', () => {
    expect(getErrorMessage(new Error('a'))).toBe('a')
    expect(getErrorMessage('b')).toBe('b')
    expect(getErrorMessage({ message: 3 })).toBe('3')
    expect(getErrorMessage(undefined)).toBe('undefined')
  })

  it('getErrorStack only for real Errors', () => {
    expect(getErrorStack(new Error('x'))).toContain('Error: x')
    expect(getErrorStack({ stack: 'fake' })).toBeUndefined()
  })

  it('a code counts only when it is a string', () => {
    expect(hasErrorCode({ code: 'P2002' })).toBe(true)
    expect(hasErrorCode({ code: 2002 })).toBe(false)
    expect(hasErrorCode(null)).toBe(false)
    expect(getPrismaErrorCode(Object.assign(new Error(), { code: 'P2025' }))).toBe('P2025')
    expect(getPrismaErrorCode(new Error())).toBeUndefined()
  })
})
