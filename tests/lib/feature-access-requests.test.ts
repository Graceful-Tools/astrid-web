/**
 * Regression tests for task dd7172d8 — Projects behind a request form and an
 * admin opt-in. These cover the demand-measurement logic, which is the whole
 * reason the feature exists.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  parseFeatureRequest,
  summarizeFeatureDemand,
  featureRequestRecipient,
  MAX_USE_CASE_LENGTH,
} from '@/lib/feature-access-requests'

describe('parseFeatureRequest (dd7172d8)', () => {
  it('accepts a known feature key', () => {
    const result = parseFeatureRequest({ featureKey: 'project_mode' })
    expect(result).toEqual({ ok: true, featureKey: 'project_mode', useCase: null })
  })

  it('rejects an unknown feature key rather than creating a junk row', () => {
    const result = parseFeatureRequest({ featureKey: 'nope_not_a_feature' })
    expect(result.ok).toBe(false)
  })

  it('rejects a missing feature key', () => {
    expect(parseFeatureRequest({ featureKey: undefined }).ok).toBe(false)
  })

  it('trims the use case and normalizes whitespace-only to null', () => {
    expect(parseFeatureRequest({ featureKey: 'project_mode', useCase: '  sprint planning  ' }))
      .toEqual({ ok: true, featureKey: 'project_mode', useCase: 'sprint planning' })
    expect(parseFeatureRequest({ featureKey: 'project_mode', useCase: '   ' }))
      .toEqual({ ok: true, featureKey: 'project_mode', useCase: null })
  })

  it('rejects a use case longer than the cap so the column cannot be used as blob storage', () => {
    const tooLong = 'x'.repeat(MAX_USE_CASE_LENGTH + 1)
    expect(parseFeatureRequest({ featureKey: 'project_mode', useCase: tooLong }).ok).toBe(false)
    const atCap = 'x'.repeat(MAX_USE_CASE_LENGTH)
    expect(parseFeatureRequest({ featureKey: 'project_mode', useCase: atCap }).ok).toBe(true)
  })

  it('rejects a non-string use case', () => {
    expect(parseFeatureRequest({ featureKey: 'project_mode', useCase: { evil: true } }).ok).toBe(false)
  })
})

describe('summarizeFeatureDemand (dd7172d8)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)

  it('counts an empty queue as zero demand', () => {
    expect(summarizeFeatureDemand([], now)).toEqual({
      total: 0, requested: 0, pending: 0, granted: 0, declined: 0, grandfathered: 0, last7Days: 0,
    })
  })

  it('excludes grandfathered users from the demand signal', () => {
    // The core requirement: users auto-granted because they already had a board
    // never asked for anything. Counting them would overstate demand on day one,
    // which is the exact question this feature exists to answer.
    const summary = summarizeFeatureDemand([
      { status: 'GRANTED', grandfathered: true, createdAt: daysAgo(1) },
      { status: 'GRANTED', grandfathered: true, createdAt: daysAgo(1) },
      { status: 'PENDING', grandfathered: false, createdAt: daysAgo(1) },
    ], now)

    expect(summary.total).toBe(3)
    expect(summary.grandfathered).toBe(2)
    expect(summary.requested).toBe(1)
    expect(summary.last7Days).toBe(1)
  })

  it('breaks the queue down by status', () => {
    const summary = summarizeFeatureDemand([
      { status: 'PENDING', grandfathered: false, createdAt: daysAgo(1) },
      { status: 'PENDING', grandfathered: false, createdAt: daysAgo(2) },
      { status: 'GRANTED', grandfathered: false, createdAt: daysAgo(3) },
      { status: 'DECLINED', grandfathered: false, createdAt: daysAgo(4) },
    ], now)

    expect(summary).toMatchObject({ pending: 2, granted: 1, declined: 1, requested: 4 })
  })

  it('windows last7Days on the request date', () => {
    const summary = summarizeFeatureDemand([
      { status: 'PENDING', grandfathered: false, createdAt: daysAgo(3) },
      { status: 'PENDING', grandfathered: false, createdAt: daysAgo(30) },
    ], now)

    expect(summary.requested).toBe(2)
    expect(summary.last7Days).toBe(1)
  })

  it('accepts ISO strings as well as Dates (API payloads arrive serialized)', () => {
    const summary = summarizeFeatureDemand([
      { status: 'PENDING', grandfathered: false, createdAt: daysAgo(1).toISOString() },
    ], now)
    expect(summary.last7Days).toBe(1)
  })
})

describe('featureRequestRecipient (dd7172d8)', () => {
  const original = process.env.FEATURE_REQUEST_EMAIL
  afterEach(() => {
    if (original === undefined) delete process.env.FEATURE_REQUEST_EMAIL
    else process.env.FEATURE_REQUEST_EMAIL = original
  })

  it('defaults to the product owner', () => {
    delete process.env.FEATURE_REQUEST_EMAIL
    expect(featureRequestRecipient()).toBe('jon@gracefultools.com')
  })

  it('is env-overridable so whitelabel partners route their own requests', () => {
    process.env.FEATURE_REQUEST_EMAIL = 'team@partner.example'
    expect(featureRequestRecipient()).toBe('team@partner.example')
  })
})
