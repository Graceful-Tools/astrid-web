"use client"

/**
 * The modal chrome both list-settings popovers render (task 9377bc2c).
 *
 * They each carried their own copy of it: the same portal-when-mounted dance,
 * the same full-screen-on-mobile / centred-card-on-desktop overlay with the
 * same two hardcoded z-indexes, the same click-outside and Escape handling, the
 * same close button. That is the part of them that genuinely WAS near-identical
 * — and the part where a divergence shows up as a modal you cannot dismiss on
 * one screen and can on another.
 *
 * What is not shared is what is inside: the system-list popover is a flat
 * filter panel keyed off a list id, the user-list one is tabbed over
 * membership, statuses and admin settings and needs a whole TaskList. Merging
 * those into one component would mean a prop set that is half-ignored on every
 * render, so the shell is the seam and the bodies stay apart.
 */

import React, { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { X } from "lucide-react"

export interface SettingsModalShellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Title row content — heading plus whatever icons the caller puts beside it. */
  header: React.ReactNode
  /** Optional line under the title. */
  subtitle?: React.ReactNode
  /** Body. Owns its own padding, since the tabbed variant pads inside its tabs. */
  children: React.ReactNode
}

export function SettingsModalShell({
  open,
  onOpenChange,
  header,
  subtitle,
  children,
}: SettingsModalShellProps) {
  // Portals need a document, and this renders during SSR too.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onOpenChange(false)
  }

  if (!mounted || !open || typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center md:items-center md:justify-center"
      style={{ zIndex: 9999 }}
      onKeyDown={handleKeyDown}
      onClick={() => onOpenChange(false)}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
    >
      <Card
        className="theme-bg-primary theme-border w-full h-full md:h-auto md:max-w-2xl md:mx-4 md:rounded-lg p-0 shadow-lg rounded-none md:shadow-lg flex flex-col"
        style={{ position: "relative", zIndex: 10000 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b theme-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">{header}</div>
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="theme-text-muted hover:theme-text-primary p-1"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {subtitle}
        </div>

        <div className="flex-1 md:max-h-96 overflow-y-auto">{children}</div>
      </Card>
    </div>,
    document.body
  )
}
