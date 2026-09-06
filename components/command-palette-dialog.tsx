"use client"

import React, { useState, useCallback, useMemo } from "react"
import { useTranslations } from "@/lib/i18n/client"
import { X, Command } from "lucide-react"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  buildActionCommands,
  filterCommands,
  moveSelection,
  type Command as CommandType,
} from "@/lib/command-palette"
import type { Task } from "@/types/task"
import type { KeyboardShortcutHandlers } from "@/hooks/useKeyboardShortcuts"

interface CommandPaletteDialogProps {
  isOpen: boolean
  onClose: () => void
  onExecuteCommand?: (command: CommandType) => void
  selectedTask: Task | null
  handlers?: KeyboardShortcutHandlers
}

export function CommandPaletteDialog({
  isOpen,
  onClose,
  onExecuteCommand,
  selectedTask,
  handlers,
}: CommandPaletteDialogProps) {
  const { t } = useTranslations()
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Build the complete command list
  const allCommands = useMemo(() => {
    return buildActionCommands(!!selectedTask)
  }, [selectedTask])

  // Filter based on query
  const displayCommands = useMemo(() => {
    return filterCommands(allCommands, query)
  }, [allCommands, query])

  // Reset selection when query changes
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Focus search input when dialog opens
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [isOpen])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
        return
      }

      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((idx) => moveSelection(idx, -1, displayCommands.length))
        return
      }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((idx) => moveSelection(idx, 1, displayCommands.length))
        return
      }

      if (e.key === "Enter") {
        e.preventDefault()
        const command = displayCommands[selectedIndex]
        if (command && !command.disabledReason) {
          handleCommandClick(command)
        }
        return
      }
    },
    [displayCommands, selectedIndex, onClose]
  )

  const handleMouseEnter = (index: number) => {
    setSelectedIndex(index)
  }

  const handleCommandClick = (command: CommandType) => {
    if (!command.disabledReason && handlers && command.action) {
      const handlerKey = command.action as keyof KeyboardShortcutHandlers
      const handler = handlers[handlerKey]
      
      if (typeof handler === 'function') {
        if (command.param !== undefined) {
          (handler as any)(command.param)
        } else {
          (handler as any)()
        }
      }
    }
    
    if (onExecuteCommand) {
      onExecuteCommand(command)
    }
    
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="theme-bg-primary theme-border w-full max-w-2xl mx-4 rounded-lg shadow-lg flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('commandPalette.label')}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b theme-border-light">
          <Command className="w-5 h-5 text-gray-400" />
          <Input
            ref={searchInputRef}
            type="text"
            placeholder={t('commandPalette.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 border-0 bg-transparent theme-text-primary placeholder-gray-400"
            autoFocus
          />
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Command List */}
        <div className="flex-1 overflow-y-auto">
          {displayCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              No commands found
            </div>
          ) : (
            <div className="py-2">
              {displayCommands.map((command, index) => (
                <button
                  key={command.id}
                  role="option"
                  aria-selected={index === selectedIndex}
                  aria-disabled={!!command.disabledReason}
                  onClick={() => handleCommandClick(command)}
                  onMouseEnter={() => handleMouseEnter(index)}
                  className={`w-full px-4 py-2 text-left flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                    index === selectedIndex ? "bg-blue-50 dark:bg-blue-950" : ""
                  } ${
                    command.disabledReason
                      ? "opacity-50 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                  disabled={!!command.disabledReason}
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {command.title}
                    </div>
                    {command.disabledReason && (
                      <div className="text-xs text-gray-500 mt-1">
                        {command.disabledReason}
                      </div>
                    )}
                  </div>
                  {command.shortcut && (
                    <kbd className="ml-4 px-2 py-1 text-xs font-mono bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border">
                      {command.shortcut}
                    </kbd>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t theme-border-light text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span>↑ ↓ to navigate</span>
            <span>{t('commandPalette.enterToSelect')}</span>
            <span>{t('commandPalette.escToClose')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
