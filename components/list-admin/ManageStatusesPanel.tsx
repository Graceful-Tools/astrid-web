"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Check, Pencil } from "lucide-react"
import { useSharedEditingSession } from "@/hooks/use-editing-session"
import { isDefaultStatusRole } from "@/lib/task-status"
import type { ProjectBoardColumn } from "@/lib/project-status"

interface ManageStatusesPanelProps {
  /**
   * The board's status columns — the same ones the board renders, defaults
   * first. Inbox and Done are excluded by the caller; they are virtual.
   */
  statuses: ProjectBoardColumn[]
  /** Re-fetch after a successful mutation so the board reflects changes. */
  onChanged: () => void
  /** The board these custom statuses belong to (task 109d8a91). */
  projectId: string
}

/**
 * Rename / add board status columns. Lives in the list-settings "Statuses"
 * tab (shown when the list has a board enabled).
 *
 * **What is editable changed with Stage D (task b7b0c2f5).** Every column used
 * to be a `listType: 'status'` TaskList, so this panel renamed and reordered
 * them with `PUT /api/v1/lists/[id]`. Those rows are deleted. A column is now
 * one of two things, and only one of them has somewhere to store an edit:
 *
 * - **Ready / Doing / Waiting** are `DEFAULT_STATES` config, shared by every
 *   board of every user. There is no per-board place to put a new name, so
 *   they are shown read-only. Renaming one was possible before and is not
 *   now; no production board had ever done it.
 * - **Custom columns** live on `Project.customStates`, so they rename through
 *   POST/PATCH `/api/statuses`.
 *
 * Reorder is gone for the same reason and has no replacement yet — the
 * defaults render in config order and customs in the order they were added.
 */
export function ManageStatusesPanel({ statuses, onChanged, projectId }: ManageStatusesPanelProps) {
  // Pending-buffer editor: a hand-off saves the typed status name (task 7b60c7c5).
  const session = useSharedEditingSession()
  const [editingRole, setEditingRole] = React.useState<string | null>(null)
  const [editingName, setEditingName] = React.useState("")
  const [newName, setNewName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  const handleRename = (column: ProjectBoardColumn) => {
    const name = editingName.trim()
    if (!name || name === column.name) {
      session.endEditing(`status-name:${column.id}`)
      setEditingRole(null)
      return
    }
    run(async () => {
      const response = await fetch("/api/statuses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: column.id, name, projectId }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to rename status")
      }
      session.endEditing(`status-name:${column.id}`)
      setEditingRole(null)
    })
  }

  // Whichever status is open registers the hand-off, so opening another editor
  // commits the rename instead of dropping it.
  const renameRef = React.useRef<{ column: ProjectBoardColumn | null; name: string }>({ column: null, name: "" })
  renameRef.current = {
    column: statuses.find(status => status.id === editingRole) ?? null,
    name: editingName,
  }
  React.useEffect(() => {
    if (!editingRole) return
    session.registerCommit(`status-name:${editingRole}`, () => {
      const { column, name } = renameRef.current
      if (column && name.trim()) handleRename(column)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, editingRole])

  const handleAdd = () => {
    const name = newName.trim()
    if (!name) return
    run(async () => {
      const response = await fetch("/api/statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, projectId }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to add status")
      }
      setNewName("")
    })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs theme-text-muted">
        Ready, Doing and Waiting apply to <strong>all</strong> of your boards. A status you
        add here belongs to this board only.
      </p>

      <div className="space-y-1.5">
        {statuses.map((status) => {
          const isBuiltIn = isDefaultStatusRole(status.id)
          return (
            <div key={status.id} className="flex items-center gap-2" data-testid={`status-row-${status.id}`}>
              {editingRole === status.id ? (
                <>
                  <Input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRename(status) }}
                    autoFocus
                    className="flex-1 h-8 text-sm"
                  />
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => handleRename(status)} aria-label="Save name">
                    <Check className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm theme-text-primary truncate">{status.name}</span>
                  {isBuiltIn ? (
                    <span className="text-xs theme-text-muted shrink-0">Built-in</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        session.beginEditing(`status-name:${status.id}`)
                        setEditingRole(status.id)
                        setEditingName(status.name)
                      }}
                      className="theme-text-muted hover:theme-text-primary p-1"
                      aria-label={`Rename ${status.name}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2 pt-1 border-t theme-border">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }}
          placeholder="New status name"
          className="flex-1 h-8 text-sm"
        />
        <Button size="sm" disabled={busy || !newName.trim()} onClick={handleAdd} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
