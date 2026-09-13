import { useEffect, RefObject } from 'react'

/**
 * Options for click-outside behavior
 */
export interface UseClickOutsideOptions {
  /**
   * Callback function called when a click occurs outside the ref element(s)
   */
  onClickOutside: () => void

  /**
   * Whether the hook is enabled
   * @default true
   */
  enabled?: boolean

  /**
   * Whether to ignore the Escape key
   * @default false
   */
  ignoreEscape?: boolean

  /**
   * Optional list of element IDs or class names to ignore
   * Clicks on these elements won't trigger onClickOutside
   */
  ignoreSelectors?: string[]
}

/**
 * Hook to detect clicks outside of specified element(s) and trigger a callback
 *
 * Useful for:
 * - Closing dropdown menus when clicking outside
 * - Auto-saving editable fields when focus is lost
 * - Dismissing modals/popovers
 *
 * @example
 * ```typescript
 * const dropdownRef = useRef<HTMLDivElement>(null)
 * useClickOutside(dropdownRef, {
 *   onClickOutside: () => setIsOpen(false),
 *   enabled: isOpen
 * })
 * ```
 *
 * @example Multiple refs
 * ```typescript
 * const buttonRef = useRef<HTMLButtonElement>(null)
 * const menuRef = useRef<HTMLDivElement>(null)
 * useClickOutside([buttonRef, menuRef], {
 *   onClickOutside: () => setIsOpen(false)
 * })
 * ```
 */
export function useClickOutside(
  // `RefObject<HTMLElement | null>`, not `RefObject<HTMLElement>`: React 19
  // types `useRef<T>(null)` as `RefObject<T | null>`, so the narrower form
  // rejected every ref a caller can actually produce — including the two in
  // this function's own docstring. (AWTD-916)
  refs: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[],
  options: UseClickOutsideOptions
) {
  const {
    onClickOutside,
    enabled = true,
    ignoreEscape = false,
    ignoreSelectors = []
  } = options

  useEffect(() => {
    if (!enabled) return

    const refArray = Array.isArray(refs) ? refs : [refs]

    const handleClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node

      // Check if click is inside any of the refs
      const clickedInside = refArray.some(ref =>
        ref.current?.contains(target)
      )

      if (clickedInside) return

      // Check if click is on an ignored element
      if (ignoreSelectors.length > 0 && target instanceof Element) {
        const matchesIgnoredSelector = ignoreSelectors.some(selector => {
          if (selector.startsWith('#')) {
            // ID selector
            return target.id === selector.slice(1)
          } else if (selector.startsWith('.')) {
            // Class selector
            return target.classList.contains(selector.slice(1))
          } else {
            // Tag name or attribute selector
            return target.matches(selector)
          }
        })

        if (matchesIgnoredSelector) return
      }

      onClickOutside()
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !ignoreEscape) {
        onClickOutside()
      }
    }

    // Use capture phase to handle clicks before they bubble
    document.addEventListener('mousedown', handleClick, true)
    document.addEventListener('touchstart', handleClick, true)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('touchstart', handleClick, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [refs, onClickOutside, enabled, ignoreEscape, ignoreSelectors])
}
