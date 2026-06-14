"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ProjectSharingManager } from "@/components/project-sharing-manager"

export interface EditableProject {
  id: string
  name: string
  description?: string | null
  color?: string | null
  imageUrl?: string | null
}

interface EditProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: EditableProject
  /** Called with the updated project after a successful save. */
  onSaved: (project: EditableProject) => void
}

const DEFAULT_COLOR = "#3b82f6"

/**
 * Edit a project's display metadata (name / description / color / image URL).
 * Wires to PATCH /api/projects/[id] (board #6). Owner-only is enforced server
 * side; the caller is responsible for only showing the trigger to owners.
 */
export function EditProjectDialog({ open, onOpenChange, project, onSaved }: EditProjectDialogProps) {
  const [name, setName] = React.useState(project.name)
  const [description, setDescription] = React.useState(project.description ?? "")
  const [color, setColor] = React.useState(project.color || DEFAULT_COLOR)
  const [imageUrl, setImageUrl] = React.useState(project.imageUrl ?? "")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Reseed the form whenever a different project (or fresh data) opens.
  React.useEffect(() => {
    if (open) {
      setName(project.name)
      setDescription(project.description ?? "")
      setColor(project.color || DEFAULT_COLOR)
      setImageUrl(project.imageUrl ?? "")
      setError(null)
    }
  }, [open, project])

  const trimmedName = name.trim()
  const canSave = trimmedName.length > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
          color,
          imageUrl: imageUrl.trim() || null,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || "Failed to save project")
        return
      }
      const data = await response.json()
      onSaved(data.project)
      onOpenChange(false)
    } catch {
      setError("Failed to save project")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="theme-bg-primary theme-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="theme-text-primary">Edit project</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="details">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="mt-4">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name" className="text-sm theme-text-secondary">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-description" className="text-sm theme-text-secondary">Description</Label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={3}
              className="w-full theme-comment-bg theme-border border theme-text-primary rounded-lg px-3 py-2 resize-vertical focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="project-color" className="text-sm theme-text-secondary">Color</Label>
            <input
              id="project-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-12 rounded border theme-border bg-transparent cursor-pointer"
            />
            <span className="text-xs theme-text-muted font-mono">{color}</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-image" className="text-sm theme-text-secondary">Image URL</Label>
            <Input
              id="project-image"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="theme-border theme-text-secondary"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
          </TabsContent>

          <TabsContent value="members" className="mt-4">
            <ProjectSharingManager projectId={project.id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
