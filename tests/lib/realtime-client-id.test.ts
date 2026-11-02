import { describe, expect, it } from 'vitest'
import {
  CLIENT_ID_HEADER,
  browserClientId,
  clientIdFromRequest,
  parseClientId,
} from '@/lib/realtime/client-id'

describe('client ids (AWTD-1497)', () => {
  it('accepts a plain id and refuses anything else', () => {
    expect(parseClientId('web_0123456789abcdef')).toBe('web_0123456789abcdef')
    expect(parseClientId(null)).toBeNull()
    expect(parseClientId('short')).toBeNull()
    expect(parseClientId('has space in it')).toBeNull()
    expect(parseClientId('x'.repeat(65))).toBeNull()
    expect(parseClientId('"><script>')).toBeNull()
  })

  it('reads the header off a request', () => {
    const request = new Request('https://example.test/x', { headers: { [CLIENT_ID_HEADER]: 'web_abcdefgh12' } })
    expect(clientIdFromRequest(request)).toBe('web_abcdefgh12')
    expect(clientIdFromRequest(new Request('https://example.test/x'))).toBeNull()
  })

  it('the browser id is stable for the page and well-formed', () => {
    const id = browserClientId()
    expect(browserClientId()).toBe(id)
    expect(parseClientId(id)).toBe(id)
  })
})
