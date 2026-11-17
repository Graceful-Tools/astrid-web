/**
 * ADEV-84: an advisory with no published fix may be accepted explicitly, by
 * id, with a reason and a review-by date. Anything not listed, or listed and
 * past its date, still blocks the gate.
 */
import { describe, it, expect } from 'vitest'
import {
  ACCEPTED_ADVISORIES,
  partitionAccepted,
  type Advisory,
  type Finding,
} from '../../scripts/audit-production-advisories'

function finding(over: Partial<Advisory> = {}, name = 'picomatch'): Finding {
  return {
    name,
    version: '4.0.7',
    paths: ['node_modules/picomatch'],
    advisory: {
      id: 1,
      url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
      title: 'ReDoS',
      severity: 'high',
      vulnerable_versions: '<=4.0.7',
      ...over,
    },
  }
}

describe('ADEV-84: accepted advisories', () => {
  const accepted = [
    {
      ghsa: 'GHSA-fc5q-39xc-vjpf',
      package: 'picomatch',
      reason: 'build-time watcher, no fix published',
      reviewBy: '2026-11-24',
    },
  ]
  const now = new Date('2026-11-20T00:00:00Z')

  it('accepts the listed advisory on the listed package before its review date', () => {
    const result = partitionAccepted([finding()], accepted, now)
    expect(result.blocking).toHaveLength(0)
    expect(result.accepted).toHaveLength(1)
  })

  it('still blocks once the review date has passed', () => {
    const result = partitionAccepted([finding()], accepted, new Date('2026-11-25T00:00:00Z'))
    expect(result.blocking).toHaveLength(1)
    expect(result.expired).toHaveLength(1)
  })

  it('does not accept the same advisory id on a different package', () => {
    const result = partitionAccepted([finding({}, 'other')], accepted, now)
    expect(result.blocking).toHaveLength(1)
  })

  it('does not accept a different advisory on the accepted package', () => {
    const other = finding({ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' })
    expect(partitionAccepted([other], accepted, now).blocking).toHaveLength(1)
  })

  it('ships the picomatch acceptance with a reason and a review date', () => {
    const entry = ACCEPTED_ADVISORIES.find(a => a.ghsa === 'GHSA-fc5q-39xc-vjpf')
    expect(entry?.package).toBe('picomatch')
    expect(entry?.reason.length).toBeGreaterThan(20)
    expect(entry?.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
