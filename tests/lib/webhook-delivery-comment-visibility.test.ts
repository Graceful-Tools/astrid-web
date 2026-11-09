import { describe, expect, it } from 'vitest'
import { isHiddenSystemComment, isSystemComment } from '@/lib/completion-streak'

const comment = { id: 'notice', content: 'Webhook delivery warning', authorId: null, createdAt: new Date() }

describe('AWTD-1561 webhook warnings are visible without Show system', () => {
  it('shows delivery notices while retaining their system authorship', () => {
    const notice = { ...comment, systemEventType: 'WEBHOOK_DELIVERY_NOTICE' }
    expect(isSystemComment(notice)).toBe(true)
    expect(isHiddenSystemComment(notice)).toBe(false)
  })

  it('keeps legacy and completion system comments hidden by default', () => {
    expect(isHiddenSystemComment(comment)).toBe(true)
    expect(isHiddenSystemComment({ ...comment, systemEventType: 'COMPLETED' })).toBe(true)
  })
})
