/**
 * Where a task callout opens beside the card it belongs to, and where its arrow points (AITD-679).
 *
 * MIRRORS astrid-core `astrid_rules::rows::callout::place` (core 144f6cf, task 011080d4) — the
 * one rule iOS, Mac, Windows and the web all place a callout by. It is a copy only because the
 * browser cannot call the core yet: the vendored WebAssembly (packages/astrid-rules) is
 * server-only. Replace this with the core's `calloutPlacement` request when a browser build of
 * the rules door lands. Until then tests/lib/callout-placement-aitd-679.test.ts holds it to every
 * case in the core's own fixture, so a change here that the core did not make fails.
 *
 * One coordinate space, the window's, y increasing downward, in CSS pixels. The caller measures
 * the callout's size; this only places it.
 */

export interface CalloutRect {
  left: number
  top: number
  width: number
  height: number
}

export type CalloutSide = 'left' | 'right'

export interface CalloutPlacement {
  side: CalloutSide
  /** The callout's own box, already clamped into the viewport. */
  left: number
  top: number
  width: number
  height: number
  /** How far DOWN the callout's anchored edge the arrow points, from `top`; kept off the corners. */
  arrowOffset: number
}

/** The gap between anchor and callout, and between callout and viewport edge. Core `GUTTER`. */
export const CALLOUT_GUTTER = 8

/** How close to a corner the arrow may point. Core `ARROW_MARGIN`. */
export const CALLOUT_ARROW_MARGIN = 20

/**
 * The core's clamp: when the bounds cross (a callout bigger than its viewport) the low bound
 * wins, so the callout is pinned to the near edge rather than thrown off the far one.
 */
function clamp(value: number, low: number, high: number): number {
  if (high < low) return low
  return Math.min(Math.max(value, low), high)
}

/** The core's side rule: whichever side of the anchor has more room, ties going right. */
export function pickCalloutSide(anchor: CalloutRect, viewport: CalloutRect): CalloutSide {
  const roomRight = viewport.left + viewport.width - (anchor.left + anchor.width)
  const roomLeft = anchor.left - viewport.left
  return roomRight >= roomLeft ? 'right' : 'left'
}

/**
 * Place a callout of `width` x `height` against `anchor`, inside `viewport`.
 *
 * The side is whichever has more room, ties going right. The box is clamped into the viewport,
 * centred on the anchor vertically where it fits, and the arrow points at the anchor's middle
 * wherever the box ended up.
 */
export function placeCallout(
  anchor: CalloutRect,
  viewport: CalloutRect,
  width: number,
  height: number,
): CalloutPlacement {
  return placeCalloutOnSide(anchor, viewport, width, height, pickCalloutSide(anchor, viewport))
}

/**
 * `placeCallout` with the side already chosen. Core DS32: the side is decided ONCE, at the tap, so
 * a panel re-placed while the board scrolls keeps its side rather than hopping across the card;
 * the box and the arrow are recomputed exactly as the core does for that side.
 */
export function placeCalloutOnSide(
  anchor: CalloutRect,
  viewport: CalloutRect,
  width: number,
  height: number,
  side: CalloutSide,
): CalloutPlacement {
  const anchorRight = anchor.left + anchor.width
  const anchorMiddle = anchor.top + anchor.height / 2
  const viewportRight = viewport.left + viewport.width
  const viewportBottom = viewport.top + viewport.height

  const wantedLeft = side === 'right' ? anchorRight + CALLOUT_GUTTER : anchor.left - CALLOUT_GUTTER - width
  const left = clamp(wantedLeft, viewport.left + CALLOUT_GUTTER, viewportRight - CALLOUT_GUTTER - width)

  const top = clamp(
    anchorMiddle - height / 2,
    viewport.top + CALLOUT_GUTTER,
    viewportBottom - CALLOUT_GUTTER - height,
  )

  const arrowOffset = clamp(
    anchorMiddle - top,
    CALLOUT_ARROW_MARGIN,
    Math.max(height - CALLOUT_ARROW_MARGIN, CALLOUT_ARROW_MARGIN),
  )

  return { side, left, top, width, height, arrowOffset }
}
