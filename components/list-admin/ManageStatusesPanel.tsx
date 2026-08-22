"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Check, Pencil, ChevronUp, ChevronDown, Trash2 } from "lucide-react"
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
 * Rename / reorder / add / delete board status columns. Lives in the
 * list-settings "Statuses" tab (shown when the list has a board enabled).
 *
 * **What is editable changed with Stage D (task b7b0c2f5).** Every column
 * used to be a `listType: 'status'` TaskList; those rows are deleted. A
 * column is now one of two things:
 *
 * - **Ready / Doing / Waiting** are `DEFAULT_STATES` config, shared by every
 *   board of every user. They can be renamed per-board via PATCH /api/statuses,
 *   which stores the override in `Project.customStates`.
 * - **Custom columns** live on `Project.customStates` and can be renamed,
 *   reordered (PUT), or deleted (DELETE).
 *
 * Reorder is custom-only: the three defaults have a fixed semantic order
 * (the standard workflow progression) and sit above all custom columns.
 */
export function ManageStatusesPanel({ statuses, onChanged, projectId }: ManageStatusesPanelProps) {
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

  const handleReorder = (column: ProjectBoardColumn, direction: "up" | "down") => {
    run(async () => {
      const response = await fetch("/api/statuses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: column.id, direction, projectId }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to reorder status")
      }
    })
  }

  const handleDelete = (column: ProjectBoardColumn) => {
    run(async () => {
      const response = await fetch("/api/statuses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: column.id, projectId }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to delete status")
      }
    })
  }

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

  // Custom-only statuses (for reorder boundary checks).
  const customStatuses = statuses.filter(s => !isDefaultStatusRole(s.id))

  return (
    <div className="space-y-3">
      <p className="text-xs theme-text-muted">
        Ready, Doing and Waiting apply to <strong>all</strong> of your boards. A status you
        add here belongs to this board only.
      </p>

      <div className="space-y-1.5">
        {statuses.map((status) => {
          const isBuiltIn = isDefaultStatusRole(status.id)
          const customIdx = isBuiltIn ? -1 : customStatuses.findIndex(s => s.id === status.id)
          const canMoveUp = !isBuiltIn && customIdx > 0
          const canMoveDown = !isBuiltIn && customIdx < customStatuses.length - 1

          return (
            <div key={status.id} className="flex items-center gap-1" data-testid={`status-row-${status.id}`}>
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

                  {/* Reorder: custom columns only */}
                  {!isBuiltIn && (
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={busy || !canMoveUp}
                        onClick={() => handleReorder(status, "up")}
                        className="theme-text-muted hover:theme-text-primary p-1 disabled:opacity-30"
                        aria-label={`Move ${status.name} up`}
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busy || !canMoveDown}
                        onClick={() => handleReorder(status, "down")}
                        className="theme-text-muted hover:theme-text-primary p-1 disabled:opacity-30"
                        aria-label={`Move ${status.name} down`}
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Rename: all columns */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      session.beginEditing(`status-name:${status.id}`)
                      setEditingRole(status.id)
                      setEditingName(status.name)
                    }}
                    className="theme-text-muted hover:theme-text-primary p-1 shrink-0"
                    aria-label={`Rename ${status.name}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete: custom columns only */}
                  {!isBuiltIn && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDelete(status)}
                      className="theme-text-muted hover:text-red-500 p-1 shrink-0"
                      aria-label={`Delete ${status.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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
