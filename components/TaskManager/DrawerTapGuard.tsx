"use client"

import React from "react"

interface DrawerTapGuardProps {
  /** Is the left drawer open? */
  open: boolean
  /** Tapping the guard closes the drawer. */
  onDismiss: () => void
}

/**
 * The transparent guard over the content area while the left drawer is open: it
 * tints what the drawer is covering and catches the tap that closes it.
 *
 * It stays mounted whether or not the drawer is open, and that is the point
 * (AWTD-1379). The guard is positioned at the drawer's FINAL left edge, so it
 * has nowhere sensible to be while the content is still sliding — and rendering
 * it only once the drawer began to open meant React inserted it with its final
 * class already applied. A freshly inserted element has no previous computed
 * style to transition from, so it painted at full strength on the first frame:
 * a grey rectangle sitting in a fixed position over content that had not moved
 * yet. Mounted up front at `opacity: 0`, adding the class is a state change the
 * browser can animate, and the CSS delays it by the drawer's own duration so it
 * only ever appears once the panel is completely open.
 */
export function DrawerTapGuard({ open, onDismiss }: DrawerTapGuardProps) {
  return (
    <div
      className={`ios-drawer-overlay ${open ? 'ios-drawer-overlay-visible' : ''}`}
      // `pointer-events: none` already keeps a closed guard out of the way in a
      // browser; leaving the handler off too means it cannot fire at all.
      onClick={open ? onDismiss : undefined}
      aria-hidden="true"
      data-testid="drawer-tap-guard"
    />
  )
}
