"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChevronUp, ChevronDown, Plus, Check, Pencil } from "lucide-react"
import type { TaskList } from "@/types/task"

interface ManageStatusesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The user's status lists (already filtered + ordered), e.g. Ready/Doing/Waiting. */
  statuses: TaskList[]
  /** Re-fetch lists after a successful mutation so the board reflects changes. */
  onChanged: () => void
}

/**
 * Rename / reorder / add board status columns (board sub-task #5).
 *
 * Statuses are per-user globals — these changes apply to *every* board the
 * user has, which the dialog states explicitly. Rename and reorder reuse
 * PUT /api/lists/[id]; add uses POST /api/statuses.
 */
export function ManageStatusesDialog({ open, onOpenChange, statuses, onChanged }: ManageStatusesDialogProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingName, setEditingName] = React.useState("")
  const [newName, setNewName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const ordered = [...statuses].sort(
    (a, b) => (a.statusOrder ?? 0) - (b.statusOrder ?? 0),
  )

  const putList = async (list: TaskList, overrides: Partial<TaskList>) => {
    const response = await fetch(`/api/lists/${list.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...list, ...overrides }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || "Failed to update status")
    }
  }

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

  const handleRename = (list: TaskList) => {
    const name = editingName.trim()
    if (!name || name === list.name) {
      setEditingId(null)
      return
    }
    run(async () => {
      await putList(list, { name })
      setEditingId(null)
    })
  }

  const handleSwap = (index: number, dir: -1 | 1) => {
    const a = ordered[index]
    const b = ordered[index + dir]
    if (!a || !b) return
    run(async () => {
      // Swap their statusOrder values.
      await putList(a, { statusOrder: b.statusOrder ?? index + dir })
      await putList(b, { statusOrder: a.statusOrder ?? index })
    })
  }

  const handleAdd = () => {
    const name = newName.trim()
    if (!name) return
    run(async () => {
      const response = await fetch("/api/statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to add status")
      }
      setNewName("")
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="theme-bg-primary theme-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="theme-text-primary">Manage statuses</DialogTitle>
        </DialogHeader>

        <p className="text-xs theme-text-muted -mt-1">
          These status columns apply to <strong>all</strong> of your boards.
        </p>

        <div className="space-y-1.5">
          {ordered.map((status, index) => (
            <div key={status.id} className="flex items-center gap-2" data-testid={`status-row-${status.id}`}>
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={busy || index === 0}
                  onClick={() => handleSwap(index, -1)}
                  className="theme-text-muted hover:theme-text-primary disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busy || index === ordered.length - 1}
                  onClick={() => handleSwap(index, 1)}
                  className="theme-text-muted hover:theme-text-primary disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {editingId === status.id ? (
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
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setEditingId(status.id); setEditingName(status.name) }}
                    className="theme-text-muted hover:theme-text-primary p-1"
                    aria-label={`Rename ${status.name}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-1 border-t theme-border mt-2">
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
      </DialogContent>
    </Dialog>
  )
}
