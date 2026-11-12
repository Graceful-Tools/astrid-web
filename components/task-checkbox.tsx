"use client"

import { useEffect, useState } from "react"
import { CheckboxArt } from "@/components/task-checkbox-art"
import { useTranslations } from "@/lib/i18n/client"

interface TaskCheckboxProps {
  checked: boolean
  onToggle: () => void
  priority: 0 | 1 | 2 | 3
  repeating?: boolean
  onClick?: (e: React.MouseEvent) => void
  /**
   * Does activating this complete the task? False where the tap opens the
   * options sheet (a board row) or does nothing (a read-only profile), so the
   * completion pop and haptic are not given for something that did not happen.
   */
  completes?: boolean
}

export function TaskCheckbox({ checked, onToggle, priority, repeating = false, onClick, completes = true }: TaskCheckboxProps) {
  const [popping, setPopping] = useState(false)
  const { t } = useTranslations()

  // Completing pops the checkbox and, where the device can, taps back: the
  // Mac's motion with iOS's haptic (docs/specs/DESIGN_SYSTEM.md → Motion).
  // Reopening does neither. The class only animates when the person has not
  // asked for reduced motion (styles/components.css).
  const toggle = () => {
    if (completes && !checked) {
      setPopping(true)
      if (typeof navigator !== 'undefined') navigator.vibrate?.(10)
    }
    onToggle()
  }
  useEffect(() => {
    if (!checked) setPopping(false)
  }, [checked])

  // A real checkbox to assistive tech and keyboards (AWTD-1339): it was a bare
  // clickable div with no role or name, so nothing — screen reader, keyboard
  // or end-to-end test — could find "the checkbox for this task".
  const toggleOnKey = (e: React.KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    e.stopPropagation()
    toggle()
  }
  
  const safePriority = typeof priority === 'number' && priority >= 0 && priority <= 3 ? priority : 0

  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-label={t(checked ? 'tasks.markIncomplete' : 'tasks.markComplete')}
      tabIndex={0}
      onKeyDown={toggleOnKey}
      className="relative p-2 -m-2 cursor-pointer flex items-center justify-center self-center"
      onClick={(e) => {
        e.stopPropagation()
        toggle()
        onClick?.(e)
      }}
    >
      <CheckboxArt
        priority={safePriority}
        checked={checked}
        repeating={repeating}
        className={popping ? "w-leading-control h-leading-control task-checkbox-pop" : "w-leading-control h-leading-control"}
        onAnimationEnd={() => setPopping(false)}
      />
    </div>
  )
}