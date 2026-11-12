"use client"

import { useId } from "react"

import { priorityTextClass } from "@/lib/design/priority"
import art from "@/packages/astrid-design/checkbox-art.json"

/**
 * The checkbox art, drawn (AWTD-1581) from astrid-core's shared art (AWTD-1605).
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
 * The shapes are astrid-core's `design/assets/checkbox`, vendored with the
 * tokens: `packages/astrid-design/checkbox-art.json` is the same drawing as
 * data (three layers: box, repeat arrows, check), so the art is still inline
 * and a list of tasks loads no images. The check is the `checkbox-check`
 * token's green over a soft black shadow. Never edit a shape here; it changes
 * in astrid-core and arrives with `scripts/sync-design-tokens.sh`.
 */
type LayerName = keyof typeof art.layers

interface ArtShape {
  role: string
  d: string
  paint: string
  width?: number
  opacity?: number
  blur?: number
}

const LAYERS = art.layers as Record<LayerName, ArtShape[]>

const CHECK_COLOR = "rgb(var(--astrid-checkbox-check))"

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
  const layers: LayerName[] = [repeating ? "repeat" : "box", ...(checked ? (["check"] as const) : [])]
  const blur = LAYERS.check.find((shape) => shape.role === "shadow")?.blur
  return (
    <svg
      data-testid="task-checkbox-art"
      data-priority={priority}
      data-checked={checked}
      data-repeating={repeating}
      viewBox={art.viewBox}
      className={`${priorityTextClass(priority)} ${className}`}
      onAnimationEnd={onAnimationEnd}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {checked && blur !== undefined && (
        <defs>
          <filter id={shadow} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={blur} />
          </filter>
        </defs>
      )}
      {layers.map((layer) => (
        <g key={layer} data-layer={layer}>
          {LAYERS[layer].map((shape, index) => {
            // The check's colour is a CSS variable, which a presentation attribute
            // does not resolve everywhere, so it goes in `style`.
            const isCheck = shape.role === "check"
            const colour = shape.role === "tint" ? "currentColor" : isCheck ? undefined : "black"
            const paint =
              shape.paint === "fill"
                ? { fill: colour, style: isCheck ? { fill: CHECK_COLOR } : undefined }
                : {
                    fill: "none",
                    stroke: colour,
                    strokeWidth: shape.width,
                    strokeOpacity: shape.opacity,
                    style: isCheck ? { stroke: CHECK_COLOR } : undefined,
                  }
            return (
              <path
                key={index}
                d={shape.d}
                {...paint}
                {...(shape.role === "shadow" ? { filter: `url(#${shadow})` } : {})}
              />
            )
          })}
        </g>
      ))}
    </svg>
  )
}
