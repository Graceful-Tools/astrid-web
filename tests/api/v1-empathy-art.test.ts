/**
 * ADEV-142: the empathy-state art is hosted here and described by GET /api/v1/empathy-art.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/base-url', () => ({ getBaseUrl: () => 'https://astrid.example/' }))

import { GET } from '@/app/api/v1/empathy-art/route'
import { buildEmpathyArtManifest, EMPATHY_ART_FRAMES, EMPATHY_ART_REVISION } from '@/lib/empathy-art/manifest'
import {
  EMPATHY_METAPHORS,
  EMPATHY_STATES,
  daysSinceEpochUTC,
  empathyMetaphorFor,
  empathyStateForColumn,
  fnv1a32,
} from '@/lib/empathy-art/rules'

const ART_DIR = join(process.cwd(), 'public/images/empathy-art')

describe('ADEV-142 hosted frames', () => {
  it('has exactly one frame per metaphor and state', () => {
    const pairs = EMPATHY_ART_FRAMES.map(frame => `${frame.metaphor}-${frame.state}`)
    const expected = EMPATHY_METAPHORS.flatMap(metaphor => EMPATHY_STATES.map(state => `${metaphor}-${state}`))
    expect(pairs).toEqual(expected)
  })

  it('serves files whose bytes match the recorded hash, size and hashed name', () => {
    for (const frame of EMPATHY_ART_FRAMES) {
      const bytes = readFileSync(join(ART_DIR, frame.file))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(frame.sha256)
      expect(bytes.length).toBe(frame.bytes)
      expect(frame.file).toBe(`${frame.metaphor}-${frame.state}.${frame.sha256.slice(0, 12)}.webp`)
    }
  })

  it('leaves no file from an earlier set behind', () => {
    expect(readdirSync(ART_DIR).sort()).toEqual(EMPATHY_ART_FRAMES.map(frame => frame.file).sort())
  })
})

describe('ADEV-142 GET /api/v1/empathy-art', () => {
  it('answers the manifest with absolute URLs and an ETag of the revision', async () => {
    const response = await GET(new Request('https://astrid.example/api/v1/empathy-art'))
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(`"${EMPATHY_ART_REVISION}"`)
    expect(response.headers.get('cache-control')).toContain('public')

    const body = await response.json()
    expect(body).toEqual(buildEmpathyArtManifest('https://astrid.example'))
    expect(body.version).toBe(1)
    expect(body.metaphors).toEqual(['race', 'wall', 'chef', 'garden', 'hike'])
    expect(body.states).toEqual(['inbox', 'ready', 'doing', 'waiting', 'done'])
    expect(body.frames).toHaveLength(25)
    expect(body.frames[0].url).toMatch(/^https:\/\/astrid\.example\/images\/empathy-art\/race-inbox\.[0-9a-f]{12}\.webp$/)
  })

  it('answers 304 when the client already has this revision', async () => {
    for (const tag of [`"${EMPATHY_ART_REVISION}"`, `W/"${EMPATHY_ART_REVISION}"`, `"other", "${EMPATHY_ART_REVISION}"`]) {
      const response = await GET(new Request('https://astrid.example/api/v1/empathy-art', { headers: { 'If-None-Match': tag } }))
      expect(response.status).toBe(304)
    }
    const stale = await GET(new Request('https://astrid.example/api/v1/empathy-art', { headers: { 'If-None-Match': '"old"' } }))
    expect(stale.status).toBe(200)
  })

  it('changes revision when any frame changes', () => {
    const before = EMPATHY_ART_REVISION
    const altered = createHash('sha256')
      .update(EMPATHY_ART_FRAMES.map((f, i) => `${f.metaphor}/${f.state}/${i === 0 ? 'x' : f.sha256}`).join('\n'))
      .digest('hex')
    expect(altered).not.toBe(before)
  })
})

describe('ADEV-142 rotation rule', () => {
  it('uses FNV-1a 32', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
  })

  it('changes day at UTC midnight, not local midnight', () => {
    expect(daysSinceEpochUTC(new Date('2026-11-19T23:59:59.999Z'))).toBe(daysSinceEpochUTC(new Date('2026-11-19T00:00:00.000Z')))
    expect(daysSinceEpochUTC(new Date('2026-11-20T00:00:00.000Z'))).toBe(daysSinceEpochUTC(new Date('2026-11-19T00:00:00.000Z')) + 1)
  })

  it('steps a list through every metaphor, one per day', () => {
    const listId = 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba'
    const days = [0, 1, 2, 3, 4].map(d => empathyMetaphorFor(listId, new Date(Date.UTC(2026, 10, 19 + d, 12))))
    expect(new Set(days).size).toBe(5)
    const first = EMPATHY_METAPHORS.indexOf(days[0])
    days.forEach((metaphor, d) => expect(metaphor).toBe(EMPATHY_METAPHORS[(first + d) % 5]))
  })

  it('maps columns to states, and custom columns to none', () => {
    expect(empathyStateForColumn({ completed: false, statusRole: null })).toBe('inbox')
    expect(empathyStateForColumn({ completed: false, statusRole: 'waiting' })).toBe('waiting')
    expect(empathyStateForColumn({ completed: true, statusRole: 'doing' })).toBe('done')
    expect(empathyStateForColumn({ completed: false, statusRole: 'custom' })).toBeNull()
  })
})
