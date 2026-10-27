/**
 * The two brand glyphs lucide-react dropped in v1 (AWTD-1391).
 *
 * lucide 1.x removed its brand/product icons, which took `Github` (ten call
 * sites) and `Chrome` (one, the Google sign-in button) with it. Nothing else
 * in the 0.x → 1.x bump touched this repo, so rather than stay a major behind
 * for two glyphs, their geometry lives here.
 *
 * These are lucide's own drawings, copied verbatim from lucide-react 0.454.0
 * and used under its ISC licence, so the icons look exactly as they did —
 * this is a packaging change, not a visual one. They take the same props as a
 * lucide icon (`className`, `size`, `strokeWidth`), so the call sites read
 * unchanged.
 *
 * Add to this file only what lucide will not carry. A glyph lucide still ships
 * belongs in lucide, where it stays in step with the rest of the set.
 */

import * as React from "react"

interface BrandIconProps extends React.SVGProps<SVGSVGElement> {
  /** Square edge length in px, as lucide's `size`. */
  size?: number | string
}

/** lucide's shared frame: same viewBox, stroke and defaults every icon uses. */
function BrandIcon({ size = 24, strokeWidth = 2, children, ...props }: BrandIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

/** lucide-react 0.454.0's `Github`, ISC. */
export function Github(props: BrandIconProps) {
  return (
    <BrandIcon {...props}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </BrandIcon>
  )
}

/** lucide-react 0.454.0's `Chrome`, ISC. */
export function Chrome(props: BrandIconProps) {
  return (
    <BrandIcon {...props}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <line x1="21.17" x2="12" y1="8" y2="8" />
      <line x1="3.95" x2="8.54" y1="6.06" y2="14" />
      <line x1="10.88" x2="15.46" y1="21.94" y2="14" />
    </BrandIcon>
  )
}
