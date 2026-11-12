/**
 * Reduced motion (astrid-core register DS17): every animation has a no-motion
 * form, used when the person has asked the system for less movement.
 *
 * Stylesheets handle CSS transitions and animations under
 * `@media (prefers-reduced-motion: reduce)` in styles/components.css. This is
 * for motion started from script, which no stylesheet can reach: a smooth
 * scroll jumps instead.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** True when the system asks for less motion. False where there is no window (SSR, tests without matchMedia). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/** `behavior` for scrollTo / scrollIntoView: smooth, unless the person asked for less motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}
