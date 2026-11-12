"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Check, Pencil, ChevronUp, ChevronDown, Trash2 } from "lucide-react"
import { useSharedEditingSession } from "@/hooks/use-editing-session"
import { isDefaultStatusRole } from "@/lib/task-status"
import { useTranslations } from "@/lib/i18n/client"
import { boardColumnBlurb, boardColumnLabel } from "@/lib/board-column-labels"
import { RichMessage, fillMessage } from "@/components/shared/RichMessage"
import type { ProjectBoardColumn } from "@/lib/project-status"
import { availableBoardPresets, type BoardPreset } from "@/lib/board-presets"
import { apiPost, refusalReason } from "@/lib/api"

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
  const { t } = useTranslations()
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
      setError(e instanceof Error ? e.message : t("messages.somethingWentWrong"))
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
        throw new Error(data.error || t("listSettings.admin.renameStatusFailed"))
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
        throw new Error(data.error || t("listSettings.admin.reorderStatusFailed"))
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
        throw new Error(data.error || t("listSettings.admin.deleteStatusFailed"))
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
        throw new Error(data.error || t("listSettings.admin.addStatusFailed"))
      }
      setNewName("")
    })
  }

  // astrid-core's optional preset columns this board can still add (R7: Testing). A preset has a
  // FIXED role, so the server is asked for the preset, never for a column by that name.
  const presets = availableBoardPresets(statuses.map(status => ({ role: status.id, name: status.name })))
  const handleAddPreset = (preset: BoardPreset) => {
    run(async () => {
      try {
        await apiPost("/api/statuses", { preset: preset.role, projectId })
      } catch (error) {
        throw new Error(refusalReason(error) ?? t("listSettings.admin.addStatusFailed"))
      }
    })
  }

  // Custom-only statuses (for reorder boundary checks).
  const customStatuses = statuses.filter(s => !isDefaultStatusRole(s.id))

  return (
    <div className="space-y-3">
      <p className="text-xs theme-text-muted">
        <RichMessage
          message={t("listSettings.admin.statusesIntro")}
          values={{ all: <strong>{t("listSettings.admin.statusesIntroAll")}</strong> }}
        />
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
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => handleRename(status)} aria-label={t("listSettings.admin.saveName")}>
                    <Check className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm theme-text-primary truncate">{boardColumnLabel(status, t)}</span>

                  {/* Reorder: custom columns only */}
                  {!isBuiltIn && (
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={busy || !canMoveUp}
                        onClick={() => handleReorder(status, "up")}
                        className="theme-text-muted hover:theme-text-primary p-1 disabled:opacity-30"
                        aria-label={fillMessage(t("listSettings.admin.moveUp"), { name: status.name })}
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busy || !canMoveDown}
                        onClick={() => handleReorder(status, "down")}
                        className="theme-text-muted hover:theme-text-primary p-1 disabled:opacity-30"
                        aria-label={fillMessage(t("listSettings.admin.moveDown"), { name: status.name })}
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
                    aria-label={fillMessage(t("listSettings.admin.renameStatus"), { name: status.name })}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete: custom columns only */}
                  {!isBuiltIn && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDelete(status)}
                      className="text-theme-muted hover:text-danger p-1 shrink-0"
                      aria-label={fillMessage(t("listSettings.admin.deleteStatus"), { name: status.name })}
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
          placeholder={t("listSettings.admin.newStatusName")}
          className="flex-1 h-8 text-sm"
        />
        <Button size="sm" disabled={busy || !newName.trim()} onClick={handleAdd} className="bg-brand hover:bg-brand-hover text-brand-foreground">
          <Plus className="w-4 h-4 mr-1" /> {t("actions.add")}
        </Button>
      </div>

      {presets.length > 0 && (
        <div className="space-y-1.5" data-testid="status-presets">
          {presets.map(preset => {
            const column = { id: preset.role, name: preset.name, description: preset.description }
            return (
              <div key={preset.role} className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleAddPreset(preset)}
                  data-testid={`status-preset-${preset.role}`}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {fillMessage(t("listSettings.admin.addPreset"), { name: boardColumnLabel(column, t) })}
                </Button>
                <span className="text-xs theme-text-muted truncate">{boardColumnBlurb(column, t)}</span>
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}
