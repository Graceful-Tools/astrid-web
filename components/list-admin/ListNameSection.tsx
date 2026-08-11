"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { unwrapList } from '@/lib/v1-response'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Check, X, Edit3 } from "lucide-react"
import { shouldPreventAutoFocus } from "@/lib/layout-detection"
import { useClickOutsideSave } from "@/hooks/use-click-outside-save"
import { useSharedEditingSession } from "@/hooks/use-editing-session"
import type { TaskList } from "@/types/task"

interface ListNameSectionProps {
  list: TaskList
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
}

/**
 * Inline List Name editor for a list's admin settings. Click to edit,
 * Enter / check / click-outside to save, Escape / X to cancel.
 *
 * On the shared editing session (task 7b60c7c5), so opening any other editor
 * anywhere commits this one rather than leaving two open. Cancel now actually
 * reverts the draft — Escape and X used to close the editor while leaving the
 * abandoned text in the buffer, so it reappeared on the next open.
 */
export function ListNameSection({ list, canEditSettings, onUpdate }: ListNameSectionProps) {
  const session = useSharedEditingSession()
  const editorId = `list-name:${list.id}`
  const editingListName = session.isEditing(editorId)
  const [tempListName, setTempListName] = useState(list.name)
  const listNameRef = useRef<HTMLDivElement>(null)

  // Keep the draft in sync when the list is updated elsewhere.
  useEffect(() => {
    setTempListName(list.name)
  }, [list.name])

  const handleSaveListName = useCallback(async () => {
    if (tempListName.trim() && tempListName !== list.name) {
      try {
        const response = await fetch(`/api/v1/lists/${list.id}`, {
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
          const updatedList = unwrapList<TaskList>(await response.json())
          if (updatedList) onUpdate(updatedList)
          else console.error('List update returned no list')
        } else {
          console.error('Failed to update list name')
        }
      } catch (error) {
        console.error('Error updating list name:', error)
      }
    }
    session.endEditing(editorId)
  }, [tempListName, list, onUpdate, session, editorId])

  // This editor holds a pending buffer, so it must register a commit: a
  // hand-off to another editor has to SAVE the typed name, not drop it.
  const saveRef = useRef(handleSaveListName)
  saveRef.current = handleSaveListName
  useEffect(() => {
    session.registerCommit(editorId, () => { void saveRef.current() })
  }, [session, editorId])

  const handleCancel = useCallback(() => {
    // Cancel is the one transition that discards — put the draft back.
    setTempListName(list.name)
    session.cancelEditing(editorId)
  }, [list.name, session, editorId])

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
              if (e.key === "Escape") handleCancel()
            }}
            className="theme-input theme-text-primary flex-1"
            autoFocus={!shouldPreventAutoFocus()}
          />
          <Button size="sm" onClick={handleSaveListName} className="bg-blue-600 hover:bg-blue-700">
            <Check className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={handleCancel}
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
            session.beginEditing(editorId)
          }}
        >
          <span className="theme-text-primary">{list.name}</span>
          <Edit3 className="w-3 h-3 theme-text-muted" />
        </div>
      )}
    </div>
  )
}
