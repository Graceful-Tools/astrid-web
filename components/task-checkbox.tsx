"use client"

import Image from "next/image"
import { useState } from "react"
import { useTranslations } from "@/lib/i18n/client"

interface TaskCheckboxProps {
  checked: boolean
  onToggle: () => void
  priority: 0 | 1 | 2 | 3
  repeating?: boolean
  onClick?: (e: React.MouseEvent) => void
}

export function TaskCheckbox({ checked, onToggle, priority, repeating = false, onClick }: TaskCheckboxProps) {
  const [imageError, setImageError] = useState(false)
  const { t } = useTranslations()

  // A real checkbox to assistive tech and keyboards (AWTD-1339): it was a bare
  // clickable div with no role or name, so nothing — screen reader, keyboard
  // or end-to-end test — could find "the checkbox for this task".
  const toggleOnKey = (e: React.KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    e.stopPropagation()
    onToggle()
  }
  
  // Map priority to checkbox number (0->0, 1->1, 2->2, 3->3) with safety fallback
  const safePriority = typeof priority === 'number' && priority >= 0 && priority <= 3 ? priority : 0
  const checkboxNumber = safePriority
  
  // Determine the icon based on state
  const getIconPath = () => {
    const prefix = repeating ? "check_box_repeat" : "check_box"
    const suffix = checked ? "_checked" : ""
    return `/icons/${prefix}${suffix}_${checkboxNumber}.png`
  }

  // Fallback checkbox for when images fail to load
  if (imageError) {
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
          onToggle()
          onClick?.(e)
        }}
      >
        <div className={`w-8 h-8 border-2 rounded-sm flex items-center justify-center ${
          checked ? 'bg-blue-500 border-blue-500' : 'border-gray-400 hover:border-gray-600'
        }`}>
          {checked && <span className="text-white text-sm">✓</span>}
        </div>
      </div>
    )
  }

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
        onToggle()
        onClick?.(e)
      }}
    >
      <Image
        src={getIconPath()}
        alt={`${checked ? 'Checked' : 'Unchecked'} ${repeating ? 'repeating ' : ''}priority ${safePriority} checkbox`}
        width={32}
        height={32}
        className="w-8 h-8"
        onError={(e) => {
          console.error('Failed to load checkbox image:', getIconPath())
          setImageError(true)
        }}
      />
    </div>
  )
}