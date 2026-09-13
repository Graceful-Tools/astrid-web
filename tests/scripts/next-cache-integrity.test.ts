/**
 * RED for AWTD-934: every route 500s under `npm run dev` before app code runs.
 *
 * The dev server parses a page's `build-manifest.json` out of `.next/dev`
 * BEFORE it invokes the page, so one corrupt manifest 500s every route while
 * `application-code` stays at ~1ms and `npm run predeploy` stays green — the
 * production build reads `.next/` root, a different tree entirely.
 *
 * The corruption is a torn write: shorter new content laid over longer old
 * content, leaving the tail of the old file behind. That is why the error is
 * always `Unexpected non-whitespace character after JSON at position N` with N
 * just short of the file size. Reproduced by appending two bytes to
 * `.next/dev/server/app/[locale]/page/build-manifest.json`: `GET / -> 500`,
 * restored: `GET / -> 200`.
 *
 * Next names no file in that error, which is the whole cost of the bug — so the
 * guard has to name it and clear the tree that holds it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { findCorruptManifests, repairNextCache } from '@/scripts/lib/next-cache-integrity'

let root: string

const write = (relative: string, contents: string) => {
  const full = join(root, relative)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, contents)
  return full
}

/** A torn write: valid JSON, then the tail of the longer file it replaced. */
const tornManifest = (relative: string) =>
  write(relative, `${JSON.stringify({ pages: { '/': ['chunk.js'] } }, null, 2)}\n}`)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'next-cache-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('findCorruptManifests', () => {
  it('says nothing about a healthy cache', () => {
    write('.next/dev/server/app/[locale]/page/build-manifest.json', '{"pages":{}}')
    write('.next/build-manifest.json', '{"pages":{}}')

    expect(findCorruptManifests(root)).toEqual([])
  })

  it('is silent when there is no .next at all', () => {
    expect(findCorruptManifests(root)).toEqual([])
  })

  it('names the torn manifest and the tree that has to be cleared (AWTD-934)', () => {
    write('.next/dev/server/app/[locale]/page/build-manifest.json', '{"pages":{}}')
    tornManifest('.next/dev/server/app/[locale]/settings/page/build-manifest.json')

    const corrupt = findCorruptManifests(root)

    expect(corrupt).toHaveLength(1)
    expect(corrupt[0].file).toBe('.next/dev/server/app/[locale]/settings/page/build-manifest.json')
    expect(corrupt[0].tree).toBe('.next/dev')
    // The reason has to carry Next's own wording, since that is what someone
    // hunting this error will have in front of them.
    expect(corrupt[0].reason).toMatch(/JSON/i)
  })

  it('blames the whole build directory when the corruption is outside .next/dev', () => {
    tornManifest('.next/server/app/[locale]/page/build-manifest.json')

    expect(findCorruptManifests(root)[0].tree).toBe('.next')
  })

  it('ignores non-JSON files, which are not parsed at boot', () => {
    write('.next/dev/server/app/[locale]/page/page.js', 'not json {{{')
    write('.next/dev/trace', 'not json either')

    expect(findCorruptManifests(root)).toEqual([])
  })
})

describe('repairNextCache', () => {
  it('clears only the dev tree, so a good production build survives', () => {
    tornManifest('.next/dev/server/app/[locale]/page/build-manifest.json')
    write('.next/BUILD_ID', 'Ppoyit70LA_VSgZUp3_v_')
    write('.next/build-manifest.json', '{"pages":{}}')

    const result = repairNextCache(root)

    expect(result.cleared).toEqual(['.next/dev'])
    expect(existsSync(join(root, '.next/dev'))).toBe(false)
    expect(readFileSync(join(root, '.next/BUILD_ID'), 'utf8')).toBe('Ppoyit70LA_VSgZUp3_v_')
  })

  it('removes .next outright when the build tree itself is torn', () => {
    tornManifest('.next/server/app/[locale]/page/build-manifest.json')

    expect(repairNextCache(root).cleared).toEqual(['.next'])
    expect(existsSync(join(root, '.next'))).toBe(false)
  })

  it('clears each affected tree once, however many files are torn', () => {
    tornManifest('.next/dev/server/app/[locale]/page/build-manifest.json')
    tornManifest('.next/dev/server/app/[locale]/settings/page/build-manifest.json')
    tornManifest('.next/server/app/[locale]/page/build-manifest.json')

    const result = repairNextCache(root)

    expect(result.corrupt).toHaveLength(3)
    // `.next/dev` lives inside `.next`, so removing `.next` covers both — the
    // guard must not try to remove a path whose parent it already deleted.
    expect(result.cleared).toEqual(['.next'])
    expect(existsSync(join(root, '.next'))).toBe(false)
  })

  it('touches nothing when the cache is healthy', () => {
    write('.next/dev/server/app/[locale]/page/build-manifest.json', '{"pages":{}}')

    const result = repairNextCache(root)

    expect(result.corrupt).toEqual([])
    expect(result.cleared).toEqual([])
    expect(existsSync(join(root, '.next/dev'))).toBe(true)
  })

  it('reports without deleting under dryRun', () => {
    tornManifest('.next/dev/server/app/[locale]/page/build-manifest.json')

    const result = repairNextCache(root, { dryRun: true })

    expect(result.cleared).toEqual(['.next/dev'])
    expect(existsSync(join(root, '.next/dev'))).toBe(true)
  })
})
