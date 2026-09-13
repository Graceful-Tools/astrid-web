import { describe, it, expect, beforeEach, vi } from 'vitest'
import { safeJsonParse, safeResponseJson, safeEventParse, hasRequiredFields } from '@/lib/safe-parse'

describe('Safe Parse Utilities', () => {
  // Suppress console errors during tests
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      const result = safeJsonParse<{ name: string } | null>('{"name":"John"}', null)
      expect(result).toEqual({ name: 'John' })
    })

    it('should return fallback for empty string', () => {
      const result = safeJsonParse<{ name: string } | null>('', null)
      expect(result).toBeNull()
    })

    it('should return fallback for whitespace-only string', () => {
      const result = safeJsonParse<{ name: string } | null>('   ', null)
      expect(result).toBeNull()
    })

    it('should return fallback for null', () => {
      const result = safeJsonParse<{ name: string } | null>(null, null)
      expect(result).toBeNull()
    })

    it('should return fallback for undefined', () => {
      const result = safeJsonParse<{ name: string } | null>(undefined, null)
      expect(result).toBeNull()
    })

    it('should return fallback for malformed JSON', () => {
      const result = safeJsonParse<{ name: string } | null>('invalid json', null)
      expect(result).toBeNull()
    })

    it('should return fallback for incomplete JSON', () => {
      const result = safeJsonParse<{ name: string } | null>('{name:', null)
      expect(result).toBeNull()
    })

    it('should parse nested objects', () => {
      const json = '{"user":{"name":"John","age":30}}'
      const result = safeJsonParse<{ user: { name: string; age: number } } | null>(json, null)
      expect(result).toEqual({ user: { name: 'John', age: 30 } })
    })

    it('should parse arrays', () => {
      const json = '[1,2,3]'
      const result = safeJsonParse<number[]>(json, [])
      expect(result).toEqual([1, 2, 3])
    })

    it('should use custom fallback value', () => {
      const fallback = { name: 'Default' }
      const result = safeJsonParse<{ name: string }>('invalid', fallback)
      expect(result).toEqual(fallback)
    })
  })

  describe('safeResponseJson', () => {
    it('should parse valid Response JSON', async () => {
      const response = new Response(JSON.stringify({ name: 'John' }), {
        headers: { 'content-type': 'application/json' }
      })

      const result = await safeResponseJson<{ name: string } | null>(response, null)
      expect(result).toEqual({ name: 'John' })
    })

    it('should return fallback for empty Response body', async () => {
      const response = new Response('', {
        headers: { 'content-length': '0' }
      })

      const result = await safeResponseJson<{ name: string } | null>(response, null)
      expect(result).toBeNull()
    })

    it('should return fallback for whitespace-only Response', async () => {
      const response = new Response('   ')

      const result = await safeResponseJson<{ name: string } | null>(response, null)
      expect(result).toBeNull()
    })

    it('should return fallback for malformed JSON Response', async () => {
      const response = new Response('invalid json')

      const result = await safeResponseJson<{ name: string } | null>(response, null)
      expect(result).toBeNull()
    })

    it('should return fallback when Response body is already consumed', async () => {
      const response = new Response(JSON.stringify({ name: 'John' }))

      // Consume the body
      await response.text()

      const result = await safeResponseJson<{ name: string } | null>(response, null)
      expect(result).toBeNull()
    })

    it('should parse nested Response objects', async () => {
      const response = new Response(JSON.stringify({
        user: { name: 'John', age: 30 }
      }))

      const result = await safeResponseJson<{ user: { name: string; age: number } } | null>(response, null)
      expect(result).toEqual({ user: { name: 'John', age: 30 } })
    })

    it('should parse array Response', async () => {
      const response = new Response(JSON.stringify([1, 2, 3]))

      const result = await safeResponseJson<number[]>(response, [])
      expect(result).toEqual([1, 2, 3])
    })

    it('should use custom fallback value', async () => {
      const response = new Response('invalid')
      const fallback = { name: 'Default' }

      const result = await safeResponseJson<{ name: string }>(response, fallback)
      expect(result).toEqual(fallback)
    })

    it('should handle Response with error status', async () => {
      const response = new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        statusText: 'Not Found'
      })

      const result = await safeResponseJson<{ error: string } | null>(response, null)
      expect(result).toEqual({ error: 'Not found' })
    })

    it('should handle Response without content-length header', async () => {
      const response = new Response(JSON.stringify({ name: 'John' }))

      const result = await safeResponseJson<{ name: string } | null>(response, null)
      expect(result).toEqual({ name: 'John' })
    })
  })

  describe('safeEventParse', () => {
    it('should parse valid SSE event data', () => {
      const eventData = '{"type":"update","data":{"id":1}}'
      const result = safeEventParse<{ type: string; data: { id: number } } | null>(eventData, null)
      expect(result).toEqual({ type: 'update', data: { id: 1 } })
    })

    it('should return fallback for empty event data', () => {
      const fallback = { type: 'error', data: { error: 'Invalid event' } }
      const result = safeEventParse('' as string, fallback)
      expect(result).toEqual(fallback)
    })

    it('should return fallback for whitespace-only event data', () => {
      const fallback = { type: 'error', data: { error: 'Invalid event' } }
      const result = safeEventParse('   ', fallback)
      expect(result).toEqual(fallback)
    })

    it('should return fallback for null event data', () => {
      const fallback = { type: 'error', data: { error: 'Invalid event' } }
      const result = safeEventParse(null, fallback)
      expect(result).toEqual(fallback)
    })

    it('should return fallback for undefined event data', () => {
      const fallback = { type: 'error', data: { error: 'Invalid event' } }
      const result = safeEventParse(undefined, fallback)
      expect(result).toEqual(fallback)
    })

    it('should return fallback for malformed event data', () => {
      const fallback = { type: 'error', data: { error: 'Invalid event' } }
      const result = safeEventParse('invalid json', fallback)
      expect(result).toEqual(fallback)
    })

    it('should parse SSE event with timestamp', () => {
      const eventData = JSON.stringify({
        type: 'task.updated',
        timestamp: '2024-01-01T00:00:00Z',
        data: { taskId: '123' }
      })

      const result = safeEventParse<{
        type: string
        timestamp: string
        data: { taskId: string }
      } | null>(eventData, null)

      expect(result).toEqual({
        type: 'task.updated',
        timestamp: '2024-01-01T00:00:00Z',
        data: { taskId: '123' }
      })
    })

    it('should use custom fallback value', () => {
      const fallback = { type: 'custom_error', message: 'Failed' }
      const result = safeEventParse('invalid', fallback)
      expect(result).toEqual(fallback)
    })
  })

  describe('hasRequiredFields', () => {
    it('should return true when all required fields exist', () => {
      const obj = { id: '123', name: 'John', age: 30 }
      expect(hasRequiredFields(obj, ['id', 'name'])).toBe(true)
    })

    it('should return false when a required field is missing', () => {
      const obj: { id: string; name?: string } = { id: '123' }
      expect(hasRequiredFields(obj, ['id', 'name'])).toBe(false)
    })

    it('should return false when a required field is null', () => {
      const obj = { id: '123', name: null }
      expect(hasRequiredFields(obj, ['id', 'name'])).toBe(false)
    })

    it('should return false when a required field is undefined', () => {
      const obj = { id: '123', name: undefined }
      expect(hasRequiredFields(obj, ['id', 'name'])).toBe(false)
    })

    it('should return false for null object', () => {
      expect(hasRequiredFields<{ id: string }>(null, ['id'])).toBe(false)
    })

    it('should return false for undefined object', () => {
      expect(hasRequiredFields<{ id: string }>(undefined, ['id'])).toBe(false)
    })

    it('should return true for empty required fields array', () => {
      const obj = { id: '123' }
      expect(hasRequiredFields(obj, [])).toBe(true)
    })

    it('should handle nested field validation', () => {
      const obj = {
        id: '123',
        user: { name: 'John' }
      }
      expect(hasRequiredFields(obj, ['id', 'user'])).toBe(true)
    })

    it('should allow false and 0 as valid field values', () => {
      const obj = { id: '123', active: false, count: 0 }
      expect(hasRequiredFields(obj, ['id', 'active', 'count'])).toBe(true)
    })

    it('should allow empty string as valid field value', () => {
      const obj = { id: '123', name: '' }
      expect(hasRequiredFields(obj, ['id', 'name'])).toBe(true)
    })
  })
})
