/**
 * RED for task b54bfb37.
 *
 * The NextAuth redirect callback ended with
 * `url.startsWith(baseUrl) ? url : baseUrl`. That is a string prefix test on an
 * origin with no trailing separator, so with baseUrl https://www.astrid.cc the
 * URL https://www.astrid.cc.evil.test/phish passes and the user is redirected
 * off-site immediately after signing in.
 */
import { describe, it, expect } from 'vitest'
import { sameOrigin } from '@/lib/auth-host'
import { BRAND } from '@/lib/brand/config'

const BASE = `https://www.${BRAND.domain}`

describe('sameOrigin', () => {
  it.each([
    ['suffix domain', `https://www.${BRAND.domain}.evil.test/phish`],
    ['prefix-lookalike', `https://www.${BRAND.domain}eviltest.com/`],
    ['userinfo trick', `https://www.${BRAND.domain}@evil.test/`],
    ['plain other host', 'https://evil.test/'],
    ['http downgrade', `http://www.${BRAND.domain}/`],
    ['not a url', 'not-a-url'],
  ])('rejects a %s', (_label, url) => {
    expect(sameOrigin(url, BASE)).toBe(false)
  })

  it.each([
    ['the base itself', `https://www.${BRAND.domain}`],
    ['a path on the base', `https://www.${BRAND.domain}/tasks?x=1`],
    // A backslash is a path separator for special schemes, so the host really
    // is the base here and the browser would navigate on-site too.
    ['a backslash that reads like a host trick but is a path', `https://www.${BRAND.domain}\\@evil.test/`],
  ])('accepts %s', (_label, url) => {
    expect(sameOrigin(url, BASE)).toBe(true)
  })
})
