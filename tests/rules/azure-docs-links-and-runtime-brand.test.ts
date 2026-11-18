// @vitest-environment node
/**
 * RULE — ADEV-100: the Azure guide and the launch checklist link only to
 * headings that exist, and do not say the brand is compiled in.
 *
 * Both pages linked `SELF_HOSTING.md#your-brand-goes-in-at-build-time` long
 * after that heading became "Your brand: mounted at runtime, or built in"
 * (AWTD-1587). GitHub renders a dead anchor as a link to the top of the page,
 * so nothing looked broken, and the prose around it kept saying the brand is
 * "applied at build time". This checks every `#anchor` these pages use against
 * the headings of the page it points at, and bans the stale wording.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = process.cwd()
const PAGES = ['docs/deployment/AZURE.md', 'docs/deployment/WHITE_LABEL_LAUNCH_CHECKLIST.md']

/** GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens. */
const slug = (heading: string) =>
  heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')

const anchorsOf = (file: string) => {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '')
  return new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => slug(m[1])))
}

/** Every relative markdown link with an anchor: `[x](#a)`, `[x](./Y.md#a)`, `[x](../Y.md#a)`. */
const anchoredLinks = (page: string) =>
  [...readFileSync(join(ROOT, page), 'utf8').matchAll(/\]\(((?:\.{1,2}\/[^)\s#]+\.md)?)#([^)\s]+)\)/g)].map(m => ({
    target: m[1] ? resolve(dirname(join(ROOT, page)), m[1]) : join(ROOT, page),
    anchor: m[2],
  }))

describe('Azure docs link to real headings (ADEV-100)', () => {
  it.each(PAGES)('ADEV-100: every #anchor in %s resolves', page => {
    const links = anchoredLinks(page)
    expect(links.length).toBeGreaterThan(0)
    const dead = links.filter(({ target, anchor }) => !anchorsOf(target).has(anchor))
    expect(dead.map(({ target, anchor }) => `${target.replace(`${ROOT}/`, '')}#${anchor}`)).toEqual([])
  })
})

describe('Azure docs describe runtime brand profiles (ADEV-100, AWTD-1587)', () => {
  it.each(PAGES)('ADEV-100: %s does not say the brand is applied at build time', page => {
    const text = readFileSync(join(ROOT, page), 'utf8')
    expect(text).not.toMatch(/applied at build time/i)
    expect(text).not.toMatch(/your-brand-goes-in-at-build-time/)
    expect(text).not.toMatch(/one image is one brand/i)
  })
})
