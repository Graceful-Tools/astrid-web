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
  /**
   * `modal` (default) is full-screen on mobile and a wide card on desktop —
   * right for List Settings, which is a lot of shared configuration.
   * `sheet` is sized to its content: a bottom sheet on mobile and a narrow
   * card on desktop, for a quick panel like Sort & Filters that should not
   * take over the screen (AWTD-1271).
   */
  variant?: "modal" | "sheet"
}

const LAYOUT = {
  modal: {
    overlay: "items-center justify-center",
    card: "w-full h-full md:h-auto md:max-w-2xl md:mx-4 md:rounded-lg rounded-none",
    body: "flex-1 md:max-h-96 overflow-y-auto",
  },
  sheet: {
    overlay: "items-end justify-center md:items-center",
    card: "w-full max-h-[85vh] rounded-t-xl rounded-b-none md:max-w-md md:mx-4 md:rounded-lg",
    body: "flex-1 min-h-0 overflow-y-auto",
  },
} as const

export function SettingsModalShell({
  open,
  onOpenChange,
  header,
  subtitle,
  children,
  variant = "modal",
}: SettingsModalShellProps) {
  const layout = LAYOUT[variant]
  // Portals need a document, and this renders during SSR too.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onOpenChange(false)
  }

  if (!mounted || !open || typeof document === "undefined") return null

  return createPortal(
    <div
      className={`fixed inset-0 bg-black bg-opacity-50 flex ${layout.overlay}`}
      style={{ zIndex: 9999 }}
      onKeyDown={handleKeyDown}
      onClick={() => onOpenChange(false)}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
    >
      <Card
        className={`theme-bg-primary theme-border p-0 shadow-lg flex flex-col ${layout.card}`}
        data-testid="settings-modal-card"
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

        <div className={layout.body}>{children}</div>
      </Card>
    </div>,
    document.body
  )
}
