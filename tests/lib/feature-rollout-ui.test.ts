import { describe, expect, it } from 'vitest'
import {
  buildFeatureRolloutDraft,
  describeEffectiveRollout,
  normalizeOverrideEmails,
  rolloutDraftChanged,
} from '@/lib/feature-rollout-ui'

describe('feature rollout admin UI policy', () => {
  it('normalizes, deduplicates, and validates override emails', () => {
    expect(normalizeOverrideEmails(' A@Example.com, a@example.com\ninvalid  b@example.com ')).toEqual({
      emails: ['a@example.com', 'b@example.com'],
      invalid: ['invalid'],
    })
  })

  it('gives exclusions precedence when a user appears in both lists', () => {
    expect(buildFeatureRolloutDraft({
      enabled: true,
      rolloutMode: 'SELECTED_USERS',
      rolloutPercentage: 0,
      included: 'a@example.com, b@example.com',
      excluded: 'b@example.com',
    })).toMatchObject({
      includedEmails: ['a@example.com'],
      excludedEmails: ['b@example.com'],
    })
  })

  it('describes master-off and selected-user behavior plainly', () => {
    expect(describeEffectiveRollout(false, 'ALL', 100, 2, 1)).toBe('Off for everyone. Saved overrides are retained but inactive.')
    expect(describeEffectiveRollout(true, 'SELECTED_USERS', 0, 2, 1)).toBe('On for 2 explicitly included users, except 1 explicitly excluded user.')
  })

  it('detects unsaved changes independently of email ordering', () => {
    const saved = buildFeatureRolloutDraft({ enabled: true, rolloutMode: 'ALL', rolloutPercentage: 100, included: 'a@example.com, b@example.com', excluded: '' })
    const reordered = buildFeatureRolloutDraft({ enabled: true, rolloutMode: 'ALL', rolloutPercentage: 100, included: 'b@example.com a@example.com', excluded: '' })
    expect(rolloutDraftChanged(saved, reordered)).toBe(false)
  })
})
