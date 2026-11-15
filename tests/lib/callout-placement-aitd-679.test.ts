// @vitest-environment node
/**
 * AITD-679 — a board card opens its task details as a callout beside the card,
 * on whichever side has more room, with the arrow aimed at the card.
 *
 * Where the callout goes is astrid-core's rule (`astrid_rules::rows::callout::place`,
 * core task 011080d4), not the web's. The browser has no core build yet (the vendored
 * WebAssembly is server-only, packages/astrid-rules), so lib/callout-placement.ts mirrors
 * it, and this test holds the mirror to EVERY case in the core's own fixture.
 *
 * tests/fixtures/core/callout-placement.json is astrid-core's
 * contracts/fixtures/callout-placement.json, copied byte for byte at core
 * 144f6cf07b581bc9eea54a75b96873c6fdf45122. It lives here rather than in
 * packages/astrid-rules/fixtures/ because that directory holds the fixtures at the
 * pinned REVISION (654e004), which predates the rule; when the pin moves past 144f6cf,
 * add `callout-placement` to scripts/build-astrid-rules.sh and read it from there.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CALLOUT_ARROW_MARGIN,
  CALLOUT_GUTTER,
  placeCallout,
  type CalloutRect,
} from '@/lib/callout-placement'

interface CalloutFixture {
  gutter: number
  arrowMargin: number
  cases: Array<{
    name: string
    rule: string
    request: { anchor: CalloutRect; viewport: CalloutRect; width: number; height: number }
    answer: {
      ok: boolean
      value: { side: 'left' | 'right'; left: number; top: number; width: number; height: number; arrowOffset: number }
    }
  }>
}

const fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'core', 'callout-placement.json'), 'utf8'),
) as CalloutFixture

describe('placeCallout mirrors astrid-core rows::callout (AITD-679)', () => {
  it('uses the core constants', () => {
    expect(CALLOUT_GUTTER).toBe(fixture.gutter)
    expect(CALLOUT_ARROW_MARGIN).toBe(fixture.arrowMargin)
  })

  it('has cases to check', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(8)
  })

  for (const c of fixture.cases) {
    it(`gives the core's answer: ${c.name} (AITD-679)`, () => {
      expect(c.rule).toBe('calloutPlacement')
      expect(c.answer.ok).toBe(true)
      const { anchor, viewport, width, height } = c.request
      expect(placeCallout(anchor, viewport, width, height)).toEqual(c.answer.value)
    })
  }

  it('pins a callout bigger than its viewport to the near edge instead of throwing (AITD-679)', () => {
    const placed = placeCallout(
      { left: 10, top: 10, width: 320, height: 64 },
      { left: 0, top: 0, width: 400, height: 300 },
      420,
      520,
    )
    expect(placed.left).toBe(CALLOUT_GUTTER)
    expect(placed.top).toBe(CALLOUT_GUTTER)
  })
})
