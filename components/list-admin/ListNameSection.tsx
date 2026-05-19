"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Check, X, Edit3 } from "lucide-react"
import { shouldPreventAutoFocus } from "@/lib/layout-detection"
import { useClickOutsideSave } from "@/hooks/use-click-outside-save"
import type { TaskList } from "@/types/task"

interface ListNameSectionProps {
  list: TaskList
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
}

/**
 * Inline List Name editor for a list's admin settings. Click to edit,
 * Enter / check / click-outside to save, Escape / X to cancel. Extracted
 * from list-admin-settings.tsx (Stage 13) — the click-outside-save is
 * now a per-section useClickOutsideSave instance.
 */
export function ListNameSection({ list, canEditSettings, onUpdate }: ListNameSectionProps) {
  const [editingListName, setEditingListName] = useState(false)
  const [tempListName, setTempListName] = useState(list.name)
  const listNameRef = useRef<HTMLDivElement>(null)

  // Keep the draft in sync when the list is updated elsewhere.
  useEffect(() => {
    setTempListName(list.name)
  }, [list.name])

  const handleSaveListName = useCallback(async () => {
    if (tempListName.trim() && tempListName !== list.name) {
      try {
        const response = await fetch(`/api/lists/${list.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...list,
            name: tempListName.trim()
          }),
        })

        if (response.ok) {
          const updatedList = await response.json()
          onUpdate(updatedList)
        } else {
          console.error('Failed to update list name')
        }
      } catch (error) {
        console.error('Error updating list name:', error)
      }
    }
    setEditingListName(false)
  }, [tempListName, list, onUpdate])

  useClickOutsideSave(listNameRef, editingListName, handleSaveListName)

  if (!canEditSettings) return null

  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm theme-text-secondary">List Name</Label>
      {editingListName ? (
        <div className="flex items-center space-x-2 flex-1 ml-4" ref={listNameRef}>
          <Input
            value={tempListName}
            onChange={(e) => setTempListName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveListName()
              if (e.key === "Escape") setEditingListName(false)
            }}
            className="theme-input theme-text-primary flex-1"
            autoFocus={!shouldPreventAutoFocus()}
          />
          <Button size="sm" onClick={handleSaveListName} className="bg-blue-600 hover:bg-blue-700">
            <Check className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditingListName(false)}
                  className="theme-border theme-text-secondary hover:theme-bg-hover">
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div
          className="flex items-center space-x-2 cursor-pointer hover:theme-bg-hover px-2 py-1 rounded flex-1 ml-4 justify-end"
          onClick={() => {
            // Track focus time for mobile keyboard protection.
            ;(window as unknown as { _lastFocusTime?: number })._lastFocusTime = Date.now()
            setEditingListName(true)
          }}
        >
          <span className="theme-text-primary">{list.name}</span>
          <Edit3 className="w-3 h-3 theme-text-muted" />
        </div>
      )}
    </div>
  )
}
