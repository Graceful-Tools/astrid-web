// @vitest-environment jsdom
/**
 * AWTD-1497 (review on #637): every write from a tab carries its client id,
 * including writes whose caller supplies its own headers. Before, any
 * `options.headers` replaced the defaults wholesale and the id went with them,
 * so that write fell back to leaving the actor's other devices out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiCall } from '@/lib/api'
import { CLIENT_ID_HEADER, browserClientId } from '@/lib/realtime/client-id'

describe('apiCall sends the tab\'s client id', () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const sentHeaders = () => (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>

  it('with the default JSON headers', async () => {
    await apiCall('/api/v1/tasks/t1', { method: 'PUT', body: '{}' })
    expect(sentHeaders()).toEqual({ 'Content-Type': 'application/json', [CLIENT_ID_HEADER]: browserClientId() })
  })

  it('alongside headers the caller supplies', async () => {
    await apiCall('/api/v1/tasks/t1', { method: 'PUT', body: '{}', headers: { 'If-Unmodified-Since': 'x' } })
    expect(sentHeaders()).toEqual({ 'If-Unmodified-Since': 'x', [CLIENT_ID_HEADER]: browserClientId() })
  })

  it('with an explicitly empty set (multipart): no Content-Type is invented', async () => {
    await apiCall('/api/upload', { method: 'POST', body: new FormData(), headers: {} })
    expect(sentHeaders()).toEqual({ [CLIENT_ID_HEADER]: browserClientId() })
  })

  it('from a Headers instance', async () => {
    await apiCall('/api/v1/tasks/t1', { method: 'PUT', body: '{}', headers: new Headers({ 'x-extra': '1' }) })
    expect(sentHeaders()).toEqual({ 'x-extra': '1', [CLIENT_ID_HEADER]: browserClientId() })
  })

  it('from tuples, keeping a repeated header\'s values (review on #638)', async () => {
    await apiCall('/api/x', { headers: [['Accept', 'application/json'], ['Accept', 'text/plain']] })
    expect(sentHeaders()).toEqual({ accept: 'application/json, text/plain', [CLIENT_ID_HEADER]: browserClientId() })
  })
})
