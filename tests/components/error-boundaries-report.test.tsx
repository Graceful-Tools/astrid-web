/**
 * Both error boundaries report what crashed (AWTD-1076).
 *
 * A task row tapped on a phone fell into the route boundary, and the exception
 * was never seen again: the boundary logged only in development. Production is
 * the one place a render error needs recording, so each boundary now sends it
 * to /api/internal/client-errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import RouteError from '@/app/[locale]/error'
import GlobalError from '@/app/global-error'
import { CLIENT_ERROR_BEACON_PATH } from '@/lib/client-error-report'

const sendBeacon = vi.fn(() => true)

async function sentBody(): Promise<Record<string, unknown>> {
  const blob = (sendBeacon.mock.calls[0] as unknown[])[1] as Blob
  return JSON.parse(await blob.text())
}

describe('error boundaries report the crash (AWTD-1076)', () => {
  beforeEach(() => {
    sendBeacon.mockClear()
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('the route boundary sends the error to the beacon', async () => {
    const error = Object.assign(new Error('boom on tap'), { digest: 'd-1' })
    render(<RouteError error={error} reset={() => {}} />)

    expect(sendBeacon).toHaveBeenCalledTimes(1)
    expect((sendBeacon.mock.calls[0] as unknown[])[0]).toBe(CLIENT_ERROR_BEACON_PATH)
    const body = await sentBody()
    expect(body).toMatchObject({ boundary: 'route', message: 'boom on tap', digest: 'd-1' })
    expect(typeof body.stack).toBe('string')
    expect(typeof body.path).toBe('string')
  })

  it('the global boundary sends the error to the beacon', async () => {
    render(<GlobalError error={new Error('layout blew up')} reset={() => {}} />, {
      container: document.createElement('div'),
    })

    expect(sendBeacon).toHaveBeenCalledTimes(1)
    const body = await sentBody()
    expect(body).toMatchObject({ boundary: 'global', message: 'layout blew up' })
  })
})
