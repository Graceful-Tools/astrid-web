"use client"

import React from "react"
import { useChatPaneCollapsed } from "@/hooks/task-manager/useChatPaneCollapsed"
import { ChatPaneToggleButton } from "./Sidebar/SidebarToggleButton"

interface DesktopChatPaneProps {
  /** Beside the board the pane is a fixed-width column, so the board's columns get the room. */
  boardMode: boolean
  /** A task or settings detail is open over the pane. */
  dimmed: boolean
  onDismissOverlay: () => void
  children: React.ReactNode
}

/**
 * The messages column on the right of the 2- and 3-column layouts, with the
 * sidebar's hide/show icon mirrored onto it (AWTD-1178). Hidden, it is a slim
 * rail holding only "Show messages" and the chat is unmounted.
 */
export function DesktopChatPane({ boardMode, dimmed, onDismissOverlay, children }: DesktopChatPaneProps) {
  const [collapsed, toggleCollapsed] = useChatPaneCollapsed()

  if (collapsed) {
    return (
      <div className="order-last theme-border border-l flex flex-col items-center pt-3 w-12 flex-shrink-0" data-testid="chat-pane-rail">
        <ChatPaneToggleButton collapsed onToggle={toggleCollapsed} />
      </div>
    )
  }

  return (
    <div
      className={`order-last h-full border-l theme-border relative flex flex-col ${boardMode ? 'flex-none w-[320px]' : 'flex-1 min-w-[280px]'} ${dimmed ? 'pointer-events-none' : ''}`}
      data-testid="chat-pane"
    >
      {dimmed && (
        <div
          className="absolute inset-0 bg-white/50 dark:bg-black/40 z-10 transition-opacity duration-200 pointer-events-auto cursor-pointer"
          onClick={onDismissOverlay}
          data-testid="chat-pane-dimmer"
        />
      )}
      <div className="px-3 pt-3 flex items-center flex-shrink-0">
        <ChatPaneToggleButton collapsed={false} onToggle={toggleCollapsed} />
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}
