import { describe, it, expect } from 'vitest'
import { AGENT_EVENT_TYPES, mapEventType } from '@/lib/agent-protocol'

describe('Agent Event Type Mapping', () => {
  describe('AGENT_EVENT_TYPES set', () => {
    it('should include all core task event types', () => {
      expect(AGENT_EVENT_TYPES.has('task_assigned')).toBe(true)
      expect(AGENT_EVENT_TYPES.has('task_created')).toBe(true)
      expect(AGENT_EVENT_TYPES.has('task_updated')).toBe(true)
      expect(AGENT_EVENT_TYPES.has('task_completed')).toBe(true)
      expect(AGENT_EVENT_TYPES.has('task_deleted')).toBe(true)
    })

    it('should include all comment event types', () => {
      expect(AGENT_EVENT_TYPES.has('comment_created')).toBe(true)
      expect(AGENT_EVENT_TYPES.has('comment_added')).toBe(true)
      expect(AGENT_EVENT_TYPES.has('agent_task_comment')).toBe(true)
    })

    it('should not include unknown event types', () => {
      expect(AGENT_EVENT_TYPES.has('task_archived')).toBe(false)
      expect(AGENT_EVENT_TYPES.has('list_created')).toBe(false)
    })

    it('should have exactly 8 event types', () => {
      expect(AGENT_EVENT_TYPES.size).toBe(8)
    })
  })

  describe('mapEventType()', () => {
    it('should map task_assigned to task.assigned', () => {
      expect(mapEventType('task_assigned')).toBe('task.assigned')
    })

    it('should map task_created to task.assigned', () => {
      expect(mapEventType('task_created')).toBe('task.assigned')
    })

    it('should map task_updated to task.updated', () => {
      expect(mapEventType('task_updated')).toBe('task.updated')
    })

    it('should map task_completed to task.completed', () => {
      expect(mapEventType('task_completed')).toBe('task.completed')
    })

    it('should map task_deleted to task.deleted', () => {
      expect(mapEventType('task_deleted')).toBe('task.deleted')
    })

    it('should map comment_created to task.commented', () => {
      expect(mapEventType('comment_created')).toBe('task.commented')
    })

    it('should map comment_added to task.commented', () => {
      expect(mapEventType('comment_added')).toBe('task.commented')
    })

    it('should map agent_task_comment to task.commented', () => {
      expect(mapEventType('agent_task_comment')).toBe('task.commented')
    })

    it('should return null for unknown event types', () => {
      expect(mapEventType('task_archived')).toBeNull()
      expect(mapEventType('list_updated')).toBeNull()
      expect(mapEventType('')).toBeNull()
    })
  })
})
