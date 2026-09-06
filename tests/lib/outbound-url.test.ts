/**
 * RED for task 3794f4ce.
 *
 * The webhook settings routes validated a URL with nothing but
 * z.string().url() and then fetched it server-side, handing the caller back the
 * status code and response time. That is an internal port scanner and a
 * cloud-metadata probe, and the same URL is reused for every real delivery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const lookup = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup, default: { lookup } }))

const { assertOutboundUrlShape, assertPublicOutboundUrl, OutboundUrlError } = await import(
  '@/lib/security/outbound-url'
)

beforeEach(() => {
  vi.clearAllMocks()
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})

describe('assertOutboundUrlShape', () => {
  it.each([
    ['cloud metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['loopback', 'https://127.0.0.1/api/internal/anything'],
    ['private v4', 'https://10.0.0.5:8080/'],
    ['carrier NAT', 'https://100.64.0.1/'],
    ['ipv6 loopback', 'https://[::1]/'],
    ['ipv6 mapped v4 loopback', 'https://[::ffff:127.0.0.1]/'],
    ['unique local v6', 'https://[fd00::1]/'],
  ])('rejects a literal %s address', (_label, raw) => {
    expect(() => assertOutboundUrlShape(raw)).toThrow(OutboundUrlError)
  })

  it('rejects plain http', () => {
    expect(() => assertOutboundUrlShape('http://example.com/hook')).toThrow(OutboundUrlError)
  })

  it('rejects embedded credentials', () => {
    expect(() => assertOutboundUrlShape('https://user:pw@example.com/hook')).toThrow(OutboundUrlError)
  })

  it('accepts an ordinary public https URL', () => {
    expect(assertOutboundUrlShape('https://hooks.example.com/a').hostname).toBe('hooks.example.com')
  })
})

describe('assertPublicOutboundUrl', () => {
  it('rejects a name that RESOLVES to a private address', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])

    await expect(assertPublicOutboundUrl('https://evil.example.com/hook')).rejects.toThrow(
      OutboundUrlError,
    )
  })

  it('rejects when any answer is private, not just the first', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ])

    await expect(assertPublicOutboundUrl('https://mixed.example.com/hook')).rejects.toThrow(
      OutboundUrlError,
    )
  })

  it('accepts a name resolving to a public address', async () => {
    await expect(assertPublicOutboundUrl('https://hooks.example.com/a')).resolves.toBeInstanceOf(URL)
  })
})
