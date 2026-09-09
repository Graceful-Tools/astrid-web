/**
 * Tests for base-url.ts - Ensures secure URL generation in all environments
 * These tests verify that insecure HTTP URLs are never returned in production
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BRAND } from '@/lib/brand/config'

describe('base-url utilities', () => {
  const originalEnv = process.env
  const originalWindow = global.window

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv }
    // @ts-ignore
    delete global.window
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-ignore
    global.window = originalWindow
    vi.resetModules()
  })

  describe('getBaseUrl', () => {
    it('should use NEXTAUTH_URL when set', async () => {
      process.env.NEXTAUTH_URL = 'https://example.com'
      const { getBaseUrl } = await import('@/lib/base-url')
      expect(getBaseUrl()).toBe('https://example.com')
    })

    it('should use NEXT_PUBLIC_BASE_URL when NEXTAUTH_URL is not set', async () => {
      delete process.env.NEXTAUTH_URL
      process.env.NEXT_PUBLIC_BASE_URL = 'https://example.com'
      const { getBaseUrl } = await import('@/lib/base-url')
      expect(getBaseUrl()).toBe('https://example.com')
    })

    it('should use VERCEL_URL with https:// prefix when set', async () => {
      delete process.env.NEXTAUTH_URL
      delete process.env.NEXT_PUBLIC_BASE_URL
      process.env.VERCEL_URL = 'my-app.vercel.app'
      const { getBaseUrl } = await import('@/lib/base-url')
      expect(getBaseUrl()).toBe('https://my-app.vercel.app')
    })

    it('should NEVER return http:// in production environment', async () => {
      delete process.env.NEXTAUTH_URL
      delete process.env.NEXT_PUBLIC_BASE_URL
      delete process.env.VERCEL_URL
      process.env.NODE_ENV = 'production'

      const { getBaseUrl } = await import('@/lib/base-url')
      const url = getBaseUrl()

      // CRITICAL: Must use HTTPS in production
      expect(url).toMatch(/^https:\/\//)
      expect(url).not.toMatch(/^http:\/\//)
    })

    it(`should use https://${BRAND.domain} as production fallback`, async () => {
      delete process.env.NEXTAUTH_URL
      delete process.env.NEXT_PUBLIC_BASE_URL
      delete process.env.VERCEL_URL
      process.env.NODE_ENV = 'production'

      const { getBaseUrl } = await import('@/lib/base-url')
      expect(getBaseUrl()).toBe(`https://${BRAND.domain}`)
    })

    it('should allow http://localhost in development', async () => {
      delete process.env.NEXTAUTH_URL
      delete process.env.NEXT_PUBLIC_BASE_URL
      delete process.env.VERCEL_URL
      process.env.NODE_ENV = 'development'

      const { getBaseUrl } = await import('@/lib/base-url')
      const url = getBaseUrl()

      // In development, localhost with http is acceptable
      expect(url).toMatch(/^http:\/\/localhost/)
    })

    it('should use window.location on client side', async () => {
      // Mock window object
      // @ts-ignore
      global.window = {
        location: {
          protocol: 'https:',
          host: 'example.com'
        }
      }

      const { getBaseUrl } = await import('@/lib/base-url')
      expect(getBaseUrl()).toBe('https://example.com')
    })

    it('should detect HTTPS from window.location in production', async () => {
      process.env.NODE_ENV = 'production'
      // @ts-ignore
      global.window = {
        location: {
          protocol: 'https:',
          host: `${BRAND.domain}`
        }
      }

      const { getBaseUrl } = await import('@/lib/base-url')
      const url = getBaseUrl()

      expect(url).toBe(`https://${BRAND.domain}`)
      expect(url).toMatch(/^https:\/\//)
    })
  })

  describe('getTaskUrl', () => {
    it('should generate task URL with HTTPS in production', async () => {
      process.env.NODE_ENV = 'production'
      process.env.NEXTAUTH_URL = `https://${BRAND.domain}`

      const { getTaskUrl } = await import('@/lib/base-url')
      const taskUrl = getTaskUrl('task-123')

      expect(taskUrl).toBe(`https://${BRAND.domain}/tasks/task-123`)
      expect(taskUrl).toMatch(/^https:\/\//)
    })

    it('should never generate insecure task URLs in production', async () => {
      delete process.env.NEXTAUTH_URL
      delete process.env.NEXT_PUBLIC_BASE_URL
      delete process.env.VERCEL_URL
      process.env.NODE_ENV = 'production'

      const { getTaskUrl } = await import('@/lib/base-url')
      const taskUrl = getTaskUrl('task-123')

      expect(taskUrl).not.toMatch(/^http:\/\//)
      expect(taskUrl).toMatch(/^https:\/\//)
    })
  })

  describe('getAIAgentWebhookUrl', () => {
    it('should generate webhook URL with HTTPS in production', async () => {
      process.env.NODE_ENV = 'production'
      process.env.NEXTAUTH_URL = `https://${BRAND.domain}`

      const { getAIAgentWebhookUrl } = await import('@/lib/base-url')
      const webhookUrl = getAIAgentWebhookUrl()

      expect(webhookUrl).toBe(`https://${BRAND.domain}/api/ai-agent/webhook`)
      expect(webhookUrl).toMatch(/^https:\/\//)
    })

    it('should never generate insecure webhook URLs in production', async () => {
      delete process.env.NEXTAUTH_URL
      delete process.env.NEXT_PUBLIC_BASE_URL
      delete process.env.VERCEL_URL
      process.env.NODE_ENV = 'production'

      const { getAIAgentWebhookUrl } = await import('@/lib/base-url')
      const webhookUrl = getAIAgentWebhookUrl()

      expect(webhookUrl).not.toMatch(/^http:\/\//)
      expect(webhookUrl).toMatch(/^https:\/\//)
    })
  })

  describe('isProduction', () => {
    it('should detect production from NODE_ENV', async () => {
      process.env.NODE_ENV = 'production'
      const { isProduction } = await import('@/lib/base-url')
      expect(isProduction()).toBe(true)
    })

    it(`should detect production from ${BRAND.domain} domain`, async () => {
      process.env.NODE_ENV = 'development'
      process.env.NEXTAUTH_URL = `https://${BRAND.domain}`
      const { isProduction } = await import('@/lib/base-url')
      expect(isProduction()).toBe(true)
    })

    it('should detect production from vercel.app domain', async () => {
      process.env.NODE_ENV = 'development'
      process.env.VERCEL_URL = 'my-app.vercel.app'
      const { isProduction } = await import('@/lib/base-url')
      expect(isProduction()).toBe(true)
    })

    it('should not detect production for localhost', async () => {
      process.env.NODE_ENV = 'development'
      delete process.env.NEXTAUTH_URL
      delete process.env.NEXT_PUBLIC_BASE_URL
      delete process.env.VERCEL_URL
      const { isProduction } = await import('@/lib/base-url')
      expect(isProduction()).toBe(false)
    })
  })

  describe('buildTaskUrlWithContext', () => {
    it('should use shortcode URL when shortcode is provided', async () => {
      process.env.NEXTAUTH_URL = `https://${BRAND.domain}`
      const { buildTaskUrlWithContext } = await import('@/lib/base-url')

      const url = buildTaskUrlWithContext('task-123', 'list-456', 'AbC123')

      expect(url).toBe(`https://${BRAND.domain}/s/AbC123`)
    })

    it('should prefer shortcode over list URL', async () => {
      process.env.NEXTAUTH_URL = `https://${BRAND.domain}`
      const { buildTaskUrlWithContext } = await import('@/lib/base-url')

      const url = buildTaskUrlWithContext('task-123', 'list-456', 'ShRtCd')

      // Should use shortcode, not list URL
      expect(url).toBe(`https://${BRAND.domain}/s/ShRtCd`)
      expect(url).not.toContain('/lists/')
      expect(url).not.toContain('/tasks/')
    })

    it('should use list URL with task param when listId provided but no shortcode', async () => {
      process.env.NEXTAUTH_URL = `https://${BRAND.domain}`
      const { buildTaskUrlWithContext } = await import('@/lib/base-url')

      const url = buildTaskUrlWithContext('task-abc', 'list-xyz', undefined)

      expect(url).toBe(`https://${BRAND.domain}/lists/list-xyz?task=task-abc`)
    })

    it('should fallback to task URL when neither listId nor shortcode provided', async () => {
      process.env.NEXTAUTH_URL = `https://${BRAND.domain}`
      const { buildTaskUrlWithContext } = await import('@/lib/base-url')

      const url = buildTaskUrlWithContext('task-789', undefined, undefined)

      expect(url).toBe(`https://${BRAND.domain}/tasks/task-789`)
    })

    it('should fallback to task URL when listId is empty string', async () => {
      process.env.NEXTAUTH_URL = `https://${BRAND.domain}`
      const { buildTaskUrlWithContext } = await import('@/lib/base-url')

      const url = buildTaskUrlWithContext('task-789', '', undefined)

      expect(url).toBe(`https://${BRAND.domain}/tasks/task-789`)
    })

    it('should use HTTPS in production environment', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.NEXTAUTH_URL
      delete process.env.NEXT_PUBLIC_BASE_URL
      delete process.env.VERCEL_URL

      const { buildTaskUrlWithContext } = await import('@/lib/base-url')

      const shortcodeUrl = buildTaskUrlWithContext('task-1', 'list-1', 'Code123')
      const listUrl = buildTaskUrlWithContext('task-2', 'list-2', undefined)
      const taskUrl = buildTaskUrlWithContext('task-3', undefined, undefined)

      expect(shortcodeUrl).toMatch(/^https:\/\//)
      expect(listUrl).toMatch(/^https:\/\//)
      expect(taskUrl).toMatch(/^https:\/\//)

      expect(shortcodeUrl).not.toMatch(/^http:\/\/[^s]/)
      expect(listUrl).not.toMatch(/^http:\/\/[^s]/)
      expect(taskUrl).not.toMatch(/^http:\/\/[^s]/)
    })

    it('should handle real-world task and list UUIDs', async () => {
      process.env.NEXTAUTH_URL = `https://${BRAND.domain}`
      const { buildTaskUrlWithContext } = await import('@/lib/base-url')

      const url = buildTaskUrlWithContext(
        'ecce0d80-e566-4217-a394-e965974a6ae1',
        '9491ff15-d887-4ad5-9f7a-5b26fd7f1a2c',
        undefined
      )

      expect(url).toBe(`https://${BRAND.domain}/lists/9491ff15-d887-4ad5-9f7a-5b26fd7f1a2c?task=ecce0d80-e566-4217-a394-e965974a6ae1`)
    })
  })

  describe('Mixed Content Prevention', () => {
    it('should prevent mixed content warnings by always using HTTPS in production', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.NEXTAUTH_URL
      delete process.env.NEXT_PUBLIC_BASE_URL
      delete process.env.VERCEL_URL

      const { getBaseUrl, getTaskUrl, getAIAgentWebhookUrl, getMCPOperationsUrl } = await import('@/lib/base-url')

      const baseUrl = getBaseUrl()
      const taskUrl = getTaskUrl('123')
      const webhookUrl = getAIAgentWebhookUrl()
      const mcpUrl = getMCPOperationsUrl()

      // All URLs must use HTTPS
      expect(baseUrl).toMatch(/^https:\/\//)
      expect(taskUrl).toMatch(/^https:\/\//)
      expect(webhookUrl).toMatch(/^https:\/\//)
      expect(mcpUrl).toMatch(/^https:\/\//)

      // None should use HTTP
      expect(baseUrl).not.toMatch(/^http:\/\/[^s]/)
      expect(taskUrl).not.toMatch(/^http:\/\/[^s]/)
      expect(webhookUrl).not.toMatch(/^http:\/\/[^s]/)
      expect(mcpUrl).not.toMatch(/^http:\/\/[^s]/)
    })
  })
})
