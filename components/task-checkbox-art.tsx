"use client"

import { useId } from "react"

import { priorityTextClass } from "@/lib/design/priority"

/**
 * The checkbox art, drawn (AWTD-1581).
 *
 * It was sixteen 56×56 PNGs, `public/icons/check_box[_repeat][_checked]_<p>.png`,
 * one per priority, so the box was the art's own blue, amber, red and grey: not
 * the priority tokens, not a partner's brand, and not Dark's lighter low
 * priority (astrid-core register DS21). Now it is one drawing whose box and
 * arrows are `currentColor`, set by the priority's text class: the priority
 * tokens, except that no priority is the theme's muted text, as the art's
 * light grey was. `priority-none` itself is 3:1 or less on Dark's card, and
 * most tasks have no priority (the same choice as the priority text, PR #699).
 *
 * The shapes are on the PNGs' own 56-unit canvas and were fitted to them,
 * then compared pixel for pixel in Chromium: the box and the arrows differ
 * only in antialiasing at their edges, the check by under one percent of the
 * canvas. The arrows are not quite rotationally symmetric in the art, so the
 * two halves keep their own measurements.
 *
 * The check keeps the art's green and its soft shadow. The tokens have no
 * colour for it yet; astrid-core's shared-assets task adds one, with the art.
 */
const CHECK_GREEN = "#89a912"

const BOX = { x: 11, y: 11, size: 34, corner: 2, line: 4 }

/** One bracket of the repeat arrows: from the bottom edge, round the left side, along the top to `top`. */
function bracket(bottom: number, top: number) {
  const { x, y, size, corner: r } = BOX
  const b = y + size
  return `M ${bottom} ${b} L ${x + r} ${b} A ${r} ${r} 0 0 1 ${x} ${b - r} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} L ${top} ${y}`
}

/** An arrowhead pointing right along the top edge, its back at `back`. */
function head(back: number, length: number, halfWidth: number) {
  const y = BOX.y
  return `${back},${y - halfWidth} ${back + length},${y} ${back},${y + halfWidth}`
}

const CHECK_POINTS = "11.5,25.75 27,39 49,10.75"
const CHECK_LINE = 9.25

interface CheckboxArtProps {
  priority: number
  checked?: boolean
  repeating?: boolean
  className?: string
  onAnimationEnd?: () => void
  /** Spoken name, where the art stands alone. Inside a labelled checkbox it is hidden. */
  label?: string
}

export function CheckboxArt({ priority, checked = false, repeating = false, className = "", onAnimationEnd, label }: CheckboxArtProps) {
  const shadow = `checkbox-shadow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const half = (bottom: number, back: number, length: number, halfWidth: number) => (
    <>
      <path d={bracket(bottom, 23)} fill="none" stroke="currentColor" strokeWidth={BOX.line} />
      <polygon points={head(back, length, halfWidth)} fill="currentColor" />
    </>
  )
  const centre = BOX.x + BOX.size / 2
  return (
    <svg
      data-testid="task-checkbox-art"
      data-priority={priority}
      data-checked={checked}
      data-repeating={repeating}
      viewBox="0 0 56 56"
      className={`${priorityTextClass(priority)} ${className}`}
      onAnimationEnd={onAnimationEnd}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {repeating ? (
        <>
          {half(21, 20.5, 7.5, 7.25)}
          <g transform={`rotate(180 ${centre} ${centre})`}>{half(23, 22.5, 7.5, 7)}</g>
        </>
      ) : (
        <rect
          x={BOX.x}
          y={BOX.y}
          width={BOX.size}
          height={BOX.size}
          rx={BOX.corner}
          fill="none"
          stroke="currentColor"
          strokeWidth={BOX.line}
        />
      )}
      {checked && (
        <>
          <defs>
            <filter id={shadow} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="0.8" />
            </filter>
          </defs>
          <polyline
            points={CHECK_POINTS}
            fill="none"
            stroke="black"
            strokeOpacity={0.85}
            strokeWidth={CHECK_LINE}
            transform="translate(0 2)"
            filter={`url(#${shadow})`}
          />
          <polyline points={CHECK_POINTS} fill="none" stroke={CHECK_GREEN} strokeWidth={CHECK_LINE} />
        </>
      )}
    </svg>
  )
}
