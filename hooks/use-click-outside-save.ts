import { useEffect, type RefObject } from "react"
import {
  shouldIgnoreTouchDuringKeyboard,
  needsAggressiveKeyboardProtection,
  getFocusProtectionThreshold,
} from "@/lib/layout-detection"

/**
 * Commit an inline editor's changes when the user clicks/taps outside it.
 *
 * One instance per editable section: pass the section's container ref,
 * whether it is currently in edit mode, and the save callback. While
 * `editing`, a mousedown/touchstart anywhere outside `ref` invokes
 * `onSave`.
 *
 * Extracted from list-admin-settings.tsx (Stage 13 saga untangle) — that
 * file had a single document listener serving both the list-name and
 * list-description editors, which blocked extracting either section.
 * Keeps the original keyboard-protection guards so a tap that is really
 * dismissing the on-screen keyboard doesn't trigger a spurious save.
 */
export function useClickOutsideSave<T extends HTMLElement>(
  ref: RefObject<T | null>,
  editing: boolean,
  onSave: () => void,
): void {
  useEffect(() => {
    if (!editing) return

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node

      // On devices that need keyboard protection, ignore touch events
      // during keyboard interactions.
      if (('touches' in event || event.type === 'touchstart') && shouldIgnoreTouchDuringKeyboard()) {
        return
      }

      // Extra protection — if this event fires right after a focus,
      // ignore it (it's likely the keyboard opening, not a real click).
      if (needsAggressiveKeyboardProtection() && event.type === 'mousedown') {
        const lastFocusTime = (window as unknown as { _lastFocusTime?: number })._lastFocusTime || 0
        if (Date.now() - lastFocusTime < getFocusProtectionThreshold()) {
          return
        }
      }

      if (ref.current && !ref.current.contains(target)) {
        onSave()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [ref, editing, onSave])
}
