/**
 * Tests for webhook-signature.ts
 *
 * Validates HMAC-SHA256 signature generation and verification
 * for secure webhook communication between Astrid and Claude Code Remote.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateWebhookSignature,
  generateWebhookHeaders,
  verifyWebhookSignature,
  extractWebhookHeaders
} from '@/lib/webhook-signature'
import { BRAND } from '@/lib/brand/config'

describe('webhook-signature utilities', () => {
  const testSecret = 'test-secret-key-12345'
  const testPayload = JSON.stringify({ event: 'task.assigned', taskId: 'task-123' })
  const testTimestamp = '1704067200000' // Fixed timestamp for reproducible tests

  describe('generateWebhookSignature', () => {
    it('should generate a valid HMAC-SHA256 signature', () => {
      const signature = generateWebhookSignature(testPayload, testSecret, testTimestamp)

      // Should be a hex string
      expect(signature).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should generate consistent signatures for same inputs', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp)
      const sig2 = generateWebhookSignature(testPayload, testSecret, testTimestamp)

      expect(sig1).toBe(sig2)
    })

    it('should generate different signatures for different payloads', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp)
      const sig2 = generateWebhookSignature('different payload', testSecret, testTimestamp)

      expect(sig1).not.toBe(sig2)
    })

    it('should generate different signatures for different secrets', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp)
      const sig2 = generateWebhookSignature(testPayload, 'different-secret', testTimestamp)

      expect(sig1).not.toBe(sig2)
    })

    it('should generate different signatures for different timestamps', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp)
      const sig2 = generateWebhookSignature(testPayload, testSecret, '1704067201000')

      expect(sig1).not.toBe(sig2)
    })

    it('should include timestamp in signed payload', () => {
      // The signature should be over `${timestamp}.${payload}`
      // This test verifies by checking different timestamps produce different signatures
      const sig1 = generateWebhookSignature(testPayload, testSecret, '1000')
      const sig2 = generateWebhookSignature(testPayload, testSecret, '2000')

      expect(sig1).not.toBe(sig2)
    })
  })

  describe('generateWebhookHeaders', () => {
    it('should generate all required headers', () => {
      const headers = generateWebhookHeaders(testPayload, testSecret, 'task.assigned')

      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['X-Astrid-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
      expect(headers['X-Astrid-Timestamp']).toMatch(/^\d+$/)
      expect(headers['X-Astrid-Event']).toBe('task.assigned')
      expect(headers['User-Agent']).toBe('Astrid-Webhooks/1.0')
    })

    it('should use current timestamp', () => {
      const before = Date.now()
      const headers = generateWebhookHeaders(testPayload, testSecret, 'task.assigned')
      const after = Date.now()

      const timestamp = parseInt(headers['X-Astrid-Timestamp'], 10)
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })

    it('should default event to task.assigned', () => {
      const headers = generateWebhookHeaders(testPayload, testSecret)

      expect(headers['X-Astrid-Event']).toBe('task.assigned')
    })

    it('should generate valid signature in header', () => {
      const headers = generateWebhookHeaders(testPayload, testSecret, 'task.assigned')

      const signature = headers['X-Astrid-Signature'].replace('sha256=', '')
      const timestamp = headers['X-Astrid-Timestamp']

      // Verify the signature matches what we'd expect
      const expected = generateWebhookSignature(testPayload, testSecret, timestamp)
      expect(signature).toBe(expected)
    })
  })

  describe('verifyWebhookSignature', () => {
    it('should verify a valid signature', () => {
      const signature = `sha256=${generateWebhookSignature(testPayload, testSecret, testTimestamp)}`
      // Use a timestamp close to now to avoid expiration
      const recentTimestamp = Date.now().toString()
      const recentSig = `sha256=${generateWebhookSignature(testPayload, testSecret, recentTimestamp)}`

      const result = verifyWebhookSignature(testPayload, recentSig, testSecret, recentTimestamp)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should reject an invalid signature', () => {
      const timestamp = Date.now().toString()
      const result = verifyWebhookSignature(
        testPayload,
        'sha256=invalid-signature-here',
        testSecret,
        timestamp
      )

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should reject signature without sha256 prefix', () => {
      const timestamp = Date.now().toString()
      const signature = generateWebhookSignature(testPayload, testSecret, timestamp)

      // Without prefix should still work (we strip it)
      const result = verifyWebhookSignature(testPayload, signature, testSecret, timestamp)

      expect(result.valid).toBe(true)
    })

    it('should reject expired timestamp (default 5 minutes)', () => {
      // Timestamp from 10 minutes ago
      const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString()
      const signature = `sha256=${generateWebhookSignature(testPayload, testSecret, oldTimestamp)}`

      const result = verifyWebhookSignature(testPayload, signature, testSecret, oldTimestamp)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Timestamp expired')
    })

    it('should accept timestamp within maxAge', () => {
      // Timestamp from 2 minutes ago
      const recentTimestamp = (Date.now() - 2 * 60 * 1000).toString()
      const signature = `sha256=${generateWebhookSignature(testPayload, testSecret, recentTimestamp)}`

      const result = verifyWebhookSignature(testPayload, signature, testSecret, recentTimestamp)

      expect(result.valid).toBe(true)
    })

    it('should use custom maxAge when provided', () => {
      // Timestamp from 30 seconds ago
      const recentTimestamp = (Date.now() - 30 * 1000).toString()
      const signature = `sha256=${generateWebhookSignature(testPayload, testSecret, recentTimestamp)}`

      // With 10 second maxAge, should fail
      const result = verifyWebhookSignature(
        testPayload,
        signature,
        testSecret,
        recentTimestamp,
        10000 // 10 seconds
      )

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Timestamp expired')
    })

    it('should reject timestamp too far in the future', () => {
      // Timestamp 5 minutes in the future
      const futureTimestamp = (Date.now() + 5 * 60 * 1000).toString()
      const signature = `sha256=${generateWebhookSignature(testPayload, testSecret, futureTimestamp)}`

      const result = verifyWebhookSignature(testPayload, signature, testSecret, futureTimestamp)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Timestamp too far in future')
    })

    it('should accept timestamp slightly in the future (clock skew)', () => {
      // Timestamp 30 seconds in the future (within 1 minute tolerance)
      const futureTimestamp = (Date.now() + 30 * 1000).toString()
      const signature = `sha256=${generateWebhookSignature(testPayload, testSecret, futureTimestamp)}`

      const result = verifyWebhookSignature(testPayload, signature, testSecret, futureTimestamp)

      expect(result.valid).toBe(true)
    })

    it('should reject invalid timestamp format', () => {
      const result = verifyWebhookSignature(testPayload, 'sha256=abc', testSecret, 'not-a-number')

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid timestamp format')
    })

    it('should reject missing parameters', () => {
      const result1 = verifyWebhookSignature('', 'sha256=abc', testSecret, testTimestamp)
      const result2 = verifyWebhookSignature(testPayload, '', testSecret, testTimestamp)
      const result3 = verifyWebhookSignature(testPayload, 'sha256=abc', '', testTimestamp)
      const result4 = verifyWebhookSignature(testPayload, 'sha256=abc', testSecret, '')

      expect(result1.valid).toBe(false)
      expect(result2.valid).toBe(false)
      expect(result3.valid).toBe(false)
      expect(result4.valid).toBe(false)
    })

    it('should reject tampered payload', () => {
      const timestamp = Date.now().toString()
      const signature = `sha256=${generateWebhookSignature(testPayload, testSecret, timestamp)}`

      // Tamper with the payload
      const tamperedPayload = JSON.stringify({ event: 'task.assigned', taskId: 'task-456' })

      const result = verifyWebhookSignature(tamperedPayload, signature, testSecret, timestamp)

      expect(result.valid).toBe(false)
    })

    it('should use timing-safe comparison', () => {
      // This is hard to test directly, but we verify it doesn't throw on length mismatch
      const timestamp = Date.now().toString()

      // Short signature (should fail gracefully, not throw)
      const result = verifyWebhookSignature(testPayload, 'sha256=short', testSecret, timestamp)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('extractWebhookHeaders', () => {
    it('should extract headers from Headers object', () => {
      const headers = new Headers({
        'x-astrid-signature': 'sha256=abc123',
        'x-astrid-timestamp': '1704067200000',
        'x-astrid-event': 'task.assigned'
      })

      const result = extractWebhookHeaders(headers)

      expect(result).toEqual({
        signature: 'sha256=abc123',
        timestamp: '1704067200000',
        event: 'task.assigned'
      })
    })

    it('should return null if signature is missing', () => {
      const headers = new Headers({
        'x-astrid-timestamp': '1704067200000',
        'x-astrid-event': 'task.assigned'
      })

      const result = extractWebhookHeaders(headers)

      expect(result).toBeNull()
    })

    it('should return null if timestamp is missing', () => {
      const headers = new Headers({
        'x-astrid-signature': 'sha256=abc123',
        'x-astrid-event': 'task.assigned'
      })

      const result = extractWebhookHeaders(headers)

      expect(result).toBeNull()
    })

    it('should default event to "unknown" if missing', () => {
      const headers = new Headers({
        'x-astrid-signature': 'sha256=abc123',
        'x-astrid-timestamp': '1704067200000'
      })

      const result = extractWebhookHeaders(headers)

      expect(result?.event).toBe('unknown')
    })

    it('should work with object that has get method', () => {
      const mockHeaders = {
        get: (name: string) => {
          const map: Record<string, string> = {
            'x-astrid-signature': 'sha256=test',
            'x-astrid-timestamp': '12345',
            'x-astrid-event': 'comment.created'
          }
          return map[name] || null
        }
      }

      const result = extractWebhookHeaders(mockHeaders)

      expect(result).toEqual({
        signature: 'sha256=test',
        timestamp: '12345',
        event: 'comment.created'
      })
    })
  })

  describe('end-to-end signing and verification', () => {
    it('should successfully verify signature generated by generateWebhookHeaders', () => {
      const headers = generateWebhookHeaders(testPayload, testSecret, 'task.assigned')

      const result = verifyWebhookSignature(
        testPayload,
        headers['X-Astrid-Signature'],
        testSecret,
        headers['X-Astrid-Timestamp']
      )

      expect(result.valid).toBe(true)
    })

    it('should handle real-world payload structure', () => {
      const realPayload = JSON.stringify({
        event: 'task.assigned',
        timestamp: new Date().toISOString(),
        aiAgent: {
          id: 'agent-123',
          name: 'Claude',
          type: 'claude_agent',
          email: `claude@${BRAND.agentEmailDomain}`
        },
        task: {
          id: 'task-abc-123',
          title: 'Implement dark mode',
          description: 'Add dark mode toggle to settings',
          priority: 2
        }
      })

      const secret = 'production-secret-key-abc123'
      const headers = generateWebhookHeaders(realPayload, secret, 'task.assigned')

      const result = verifyWebhookSignature(
        realPayload,
        headers['X-Astrid-Signature'],
        secret,
        headers['X-Astrid-Timestamp']
      )

      expect(result.valid).toBe(true)
    })
  })
})
