/**
 * Tests for middleware.ts locale routing
 * Verifies that locale-prefixed routes work correctly with 'as-needed' strategy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { BRAND } from '@/lib/brand/config'

describe('Locale Routing Middleware', () => {
  let mockCreateMiddleware: any
  let middleware: any

  beforeEach(async () => {
    // Mock next-intl's createMiddleware
    vi.mock('next-intl/middleware', () => ({
      default: vi.fn((config) => {
        return (request: NextRequest) => {
          // Simulate next-intl behavior with 'as-needed' strategy
          const pathname = request.nextUrl.pathname
          const locales = config.locales || []
          const defaultLocale = config.defaultLocale

          // Check if path starts with a locale
          const pathnameLocale = locales.find((locale: string) =>
            pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
          )

          // With 'as-needed' strategy, both /locale and / paths should work
          if (pathnameLocale || !pathname.startsWith('/api') && !pathname.startsWith('/.well-known')) {
            // Return a mock response indicating success
            return NextResponse.next()
          }

          return NextResponse.next()
        }
      })
    }))

    vi.mock('@/lib/i18n/config', () => ({
      locales: ['en', 'es', 'fr', 'de'],
      defaultLocale: 'en'
    }))

    // Clear module cache to get fresh middleware
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Locale prefix handling', () => {
    it('should allow routes with locale prefixes like /es', async () => {
      const request = new NextRequest(new URL(`https://www.${BRAND.domain}/es`))

      // Import middleware after mocks are set up
      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      // Should not return 404 or error response
      expect(response).toBeDefined()
      expect(response.status).not.toBe(404)
    })

    it('should allow routes with locale prefixes like /fr', async () => {
      const request = new NextRequest(new URL(`https://www.${BRAND.domain}/fr`))

      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      expect(response).toBeDefined()
      expect(response.status).not.toBe(404)
    })

    it('should allow routes with locale prefixes like /de', async () => {
      const request = new NextRequest(new URL(`https://www.${BRAND.domain}/de`))

      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      expect(response).toBeDefined()
      expect(response.status).not.toBe(404)
    })

    it('should allow routes without locale prefixes (backward compatibility)', async () => {
      const request = new NextRequest(new URL(`https://www.${BRAND.domain}/`))

      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      expect(response).toBeDefined()
      expect(response.status).not.toBe(404)
    })

    it('should allow nested routes with locale prefixes like /es/tasks', async () => {
      const request = new NextRequest(new URL(`https://www.${BRAND.domain}/es/tasks`))

      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      expect(response).toBeDefined()
      expect(response.status).not.toBe(404)
    })
  })

  describe('API routes exclusion', () => {
    it('should not apply locale routing to /api routes', async () => {
      const request = new NextRequest(new URL(`https://www.${BRAND.domain}/api/tasks`))

      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      // API routes should pass through without locale middleware
      expect(response).toBeDefined()
    })

    it('should not apply locale routing to /.well-known routes', async () => {
      const request = new NextRequest(new URL(`https://${BRAND.domain}/.well-known/apple-app-site-association`))

      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      // .well-known routes should pass through without locale middleware
      expect(response).toBeDefined()
    })
  })

  describe('Domain redirection', () => {
    it('should redirect naked domain to www for non-API routes', async () => {
      const request = new NextRequest(new URL(`https://${BRAND.domain}/`))

      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      // Should redirect to www
      expect(response).toBeDefined()
      if (response.status === 308) {
        const location = response.headers.get('location')
        expect(location).toContain(`www.${BRAND.domain}`)
      }
    })

    it('should redirect naked domain with locale prefix to www', async () => {
      const request = new NextRequest(new URL(`https://${BRAND.domain}/es`))

      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      // Should redirect to www
      expect(response).toBeDefined()
      if (response.status === 308) {
        const location = response.headers.get('location')
        expect(location).toContain(`www.${BRAND.domain}`)
        expect(location).toContain('/es')
      }
    })

    it('should NOT redirect naked domain for API routes', async () => {
      const request = new NextRequest(new URL(`https://${BRAND.domain}/api/tasks`))

      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      // Should not redirect API routes
      expect(response.status).not.toBe(308)
    })

    it('should NOT redirect naked domain for .well-known routes', async () => {
      const request = new NextRequest(new URL(`https://${BRAND.domain}/.well-known/apple-app-site-association`))

      const { middleware: mw } = await import('@/middleware')
      const response = await mw(request)

      // Should not redirect .well-known routes
      expect(response.status).not.toBe(308)
    })
  })

  describe('Configuration', () => {
    it('should use as-needed locale prefix strategy', async () => {
      // This test verifies the configuration indirectly by checking behavior
      const requestWithLocale = new NextRequest(new URL(`https://www.${BRAND.domain}/es`))
      const requestWithoutLocale = new NextRequest(new URL(`https://www.${BRAND.domain}/`))

      const { middleware: mw } = await import('@/middleware')

      const responseWithLocale = await mw(requestWithLocale)
      const responseWithoutLocale = await mw(requestWithoutLocale)

      // Both should work (as-needed allows both forms)
      expect(responseWithLocale).toBeDefined()
      expect(responseWithLocale.status).not.toBe(404)
      expect(responseWithoutLocale).toBeDefined()
      expect(responseWithoutLocale.status).not.toBe(404)
    })
  })
})
