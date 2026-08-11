"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronUp, ChevronDown, Plus, Check, Pencil } from "lucide-react"
import { useSharedEditingSession } from "@/hooks/use-editing-session"
import type { TaskList } from "@/types/task"

interface ManageStatusesPanelProps {
  /** The user's status lists (already filtered + ordered), e.g. Ready/Doing/Waiting. */
  statuses: TaskList[]
  /** Re-fetch lists after a successful mutation so the board reflects changes. */
  onChanged: () => void
  /** The board these custom statuses belong to (task 109d8a91). */
  projectId: string
}

/**
 * Rename / reorder / add board status columns. Lives in the list-settings
 * "Statuses" tab (shown when the list has a board enabled).
 *
 * The three default statuses (Ready/Doing/Waiting) are per-user and apply to
 * every board; a custom status added here belongs to THIS board only
 * (task 109d8a91). Rename and reorder reuse PUT /api/lists/[id]; add uses
 * POST /api/statuses.
 */
export function ManageStatusesPanel({ statuses, onChanged, projectId }: ManageStatusesPanelProps) {
  // Pending-buffer editor: a hand-off saves the typed status name (task 7b60c7c5).
  const session = useSharedEditingSession()
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingName, setEditingName] = React.useState("")
  const [newName, setNewName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const ordered = [...statuses].sort(
    (a, b) => (a.statusOrder ?? 0) - (b.statusOrder ?? 0),
  )

  const putList = async (list: TaskList, overrides: Partial<TaskList>) => {
    const response = await fetch(`/api/v1/lists/${list.id}`, {
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
      session.endEditing(`status-name:${list.id}`)
      setEditingId(null)
      return
    }
    run(async () => {
      await putList(list, { name })
      session.endEditing(`status-name:${list.id}`)
      setEditingId(null)
    })
  }

  // Whichever status is open registers the hand-off, so opening another editor
  // commits the rename instead of dropping it.
  const renameRef = React.useRef<{ list: TaskList | null; name: string }>({ list: null, name: "" })
  renameRef.current = {
    list: ordered.find(status => status.id === editingId) ?? null,
    name: editingName,
  }
  React.useEffect(() => {
    if (!editingId) return
    session.registerCommit(`status-name:${editingId}`, () => {
      const { list, name } = renameRef.current
      if (list && name.trim()) handleRename(list)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, editingId])

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
                  onClick={() => {
                    session.beginEditing(`status-name:${status.id}`)
                    setEditingId(status.id)
                    setEditingName(status.name)
                  }}
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
