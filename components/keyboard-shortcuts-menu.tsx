"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Keyboard, X } from "lucide-react"
import { KEYBOARD_SHORTCUTS } from "@/hooks/useKeyboardShortcuts"

interface KeyboardShortcutsMenuProps {
  isOpen: boolean
  onClose: () => void
}

export function KeyboardShortcutsMenu({ isOpen, onClose }: KeyboardShortcutsMenuProps) {
  const groupedShortcuts = React.useMemo(() => {
    const groups = {
      navigation: [] as (typeof KEYBOARD_SHORTCUTS)[number][],
      taskActions: [] as (typeof KEYBOARD_SHORTCUTS)[number][],
      taskEditing: [] as (typeof KEYBOARD_SHORTCUTS)[number][],
      priorities: [] as (typeof KEYBOARD_SHORTCUTS)[number][],
      ui: [] as (typeof KEYBOARD_SHORTCUTS)[number][],
    }

    KEYBOARD_SHORTCUTS.forEach(shortcut => {
      if (['k', 'j', 'o', 'l', 'd'].includes(shortcut.key)) {
        groups.navigation.push(shortcut)
      } else if (['n', 'x', 'Delete', 'Backspace', '←', '→', 'p', 'v'].includes(shortcut.key)) {
        groups.taskActions.push(shortcut)
      } else if (['i', 't', 's', 'c', 'e'].includes(shortcut.key)) {
        groups.taskEditing.push(shortcut)
      } else if (['0', '1', '2', '3'].includes(shortcut.key)) {
        groups.priorities.push(shortcut)
      } else {
        groups.ui.push(shortcut)
      }
    })

    return groups
  }, [])

  const formatKey = (key: string) => {
    switch (key) {
      case 'ArrowLeft':
      case '←':
        return '←'
      case 'ArrowRight':
      case '→':
        return '→'
      case 'Delete':
        return 'Del'
      case 'Backspace':
        return '⌫'
      default:
        return key
    }
  }

  const ShortcutGroup = ({ title, shortcuts }: { title: string; shortcuts: (typeof KEYBOARD_SHORTCUTS)[number][] }) => (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
        {title}
      </h3>
      <div className="space-y-1">
        {shortcuts.map((shortcut, index) => (
          <div key={`${shortcut.key}-${index}`} className="flex items-center justify-between py-1">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {shortcut.description}
            </span>
            <kbd className="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border">
              {formatKey(shortcut.key)}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  )

  if (!isOpen) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <Card
        className="theme-bg-primary theme-border w-full max-w-4xl mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-2">
              <Keyboard className="w-5 h-5" />
              <h2 className="text-xl font-semibold">Keyboard Shortcuts</h2>
            </div>
            <Button variant="outline" onClick={onClose} size="sm" aria-label="Close">
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ShortcutGroup title="Navigation" shortcuts={groupedShortcuts.navigation} />
            <ShortcutGroup title="Task Actions" shortcuts={groupedShortcuts.taskActions} />
            <ShortcutGroup title="Task Editing" shortcuts={groupedShortcuts.taskEditing} />
            <ShortcutGroup title="Priority" shortcuts={groupedShortcuts.priorities} />
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <ShortcutGroup title="Interface" shortcuts={groupedShortcuts.ui} />
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                Chat & References
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-2">
                Use in chat messages and task comments
              </p>
              <div className="space-y-1">
                {[
                  { key: '@', desc: 'Mention a person' },
                  { key: '#', desc: 'Reference a list' },
                  { key: '!', desc: 'Reference a task' },
                  { key: 'Tab', desc: 'Select autocomplete suggestion' },
                  { key: '↑ ↓', desc: 'Navigate suggestions' },
                  { key: 'Esc', desc: 'Dismiss suggestions' },
                ].map(({ key, desc }) => (
                  <div key={key} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-600 dark:text-gray-400">{desc}</span>
                    <kbd className="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default KeyboardShortcutsMenu