"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { FileText, Edit3, Eye, Bot, ChevronDown, ChevronRight, Sparkles, Check, Info } from "lucide-react"
import { renderMarkdown, sanitizeTextToHtml } from "@/lib/markdown"
import { useClickOutsideSave } from "@/hooks/use-click-outside-save"
import { useSharedEditingSession } from "@/hooks/use-editing-session"
import type { TaskList } from "@/types/task"

interface AgentInstructionsSectionProps {
  list: TaskList
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
}

const STARTER_TEMPLATES = [
  {
    name: "Code Reviewer",
    instructions: "Review code changes for this project.\n\n## Focus Areas\n- Security vulnerabilities (XSS, injection, auth issues)\n- Test coverage gaps\n- Code style consistency\n- Performance concerns\n\n## How to Work\n1. Read the task description and any linked PRs\n2. Post findings as comments\n3. If everything looks good, say so and mark complete"
  },
  {
    name: "Research Assistant",
    instructions: "Research the topic described in the task.\n\n## Deliverables\n1. Summary of key findings (2-3 paragraphs)\n2. Links to primary sources\n3. Conflicting viewpoints or caveats\n4. Recommended next steps\n\n## Guidelines\n- Be thorough but concise\n- Cite sources\n- Flag low-confidence claims"
  },
  {
    name: "Family Assistant",
    instructions: "You help our family stay organized.\n\n## How to Help\n- Research options and present pros/cons\n- Be friendly and practical\n- Ask for preferences rather than guessing\n- Don't make purchases or bookings — just recommend\n\n## Guardrails\n- Keep suggestions family-friendly\n- Respect our budget\n- Post updates as comments"
  },
  {
    name: "Content Writer",
    instructions: "Write content based on the task description.\n\n## Voice & Style\n- Casual but professional\n- Short sentences, no jargon\n- Use examples and analogies\n\n## Process\n1. Post a draft as a comment\n2. Wait for feedback before marking complete\n3. Revise based on comments"
  }
]

/**
 * Agent Instructions editor for a list's admin settings — the list
 * description that AI agents receive as primary context. Inline editor
 * with a markdown edit/preview toggle and starter templates. Extracted
 * from list-admin-settings.tsx (Stage 13).
 */
export function AgentInstructionsSection({ list, canEditSettings, onUpdate }: AgentInstructionsSectionProps) {
  const session = useSharedEditingSession()
  const editorId = `list-instructions:${list.id}`
  const editingListDescription = session.isEditing(editorId)
  const [tempListDescription, setTempListDescription] = useState(list.description || "")
  const [showInstructionPreview, setShowInstructionPreview] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const listDescriptionRef = useRef<HTMLDivElement>(null)

  // Keep the draft in sync when the list is updated elsewhere.
  useEffect(() => {
    setTempListDescription(list.description || "")
  }, [list.description])

  const handleSaveListDescription = useCallback(async () => {
    if (tempListDescription !== (list.description || "")) {
      try {
        const response = await fetch(`/api/lists/${list.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...list,
            description: tempListDescription.trim() || undefined
          }),
        })

        if (response.ok) {
          const updatedList = await response.json()
          onUpdate(updatedList)
        } else {
          console.error('Failed to update list description')
        }
      } catch (error) {
        console.error('Error updating list description:', error)
      }
    }
    session.endEditing(editorId)
  }, [tempListDescription, list, onUpdate, session, editorId])

  // Holds a pending buffer, so a hand-off must SAVE the typed instructions.
  const saveRef = useRef(handleSaveListDescription)
  saveRef.current = handleSaveListDescription
  useEffect(() => {
    session.registerCommit(editorId, () => { void saveRef.current() })
  }, [session, editorId])

  useClickOutsideSave(listDescriptionRef, editingListDescription, handleSaveListDescription)

  if (!canEditSettings) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm theme-text-secondary flex items-center space-x-1.5">
          <FileText className="w-4 h-4" />
          <span>List Description</span>
          <Info
            className="w-3.5 h-3.5 theme-text-muted"
            aria-label="The list description is used as instructions for AI agents that work in this list"
          >
            <title>The list description is used as instructions for AI agents that work in this list</title>
          </Info>
        </Label>
      </div>
      {editingListDescription ? (
        <div className="mt-1" ref={listDescriptionRef}>
          {/* Edit / Preview toggle */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => setShowInstructionPreview(false)}
                className={`text-xs px-2 py-1 rounded ${!showInstructionPreview ? 'bg-blue-600 text-white' : 'theme-text-muted hover:theme-bg-hover'}`}
              >
                <Edit3 className="w-3 h-3 inline mr-1" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => setShowInstructionPreview(true)}
                className={`text-xs px-2 py-1 rounded ${showInstructionPreview ? 'bg-blue-600 text-white' : 'theme-text-muted hover:theme-bg-hover'}`}
              >
                <Eye className="w-3 h-3 inline mr-1" />
                Preview
              </button>
            </div>
            <span className="text-xs theme-text-muted">
              {tempListDescription.length} chars
            </span>
          </div>

          {showInstructionPreview ? (
            <div
              className="w-full theme-comment-bg theme-border border rounded-lg px-3 py-2 min-h-[120px] prose prose-sm max-w-none theme-text-primary"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(tempListDescription || '*No instructions yet*') }}
            />
          ) : (
            <textarea
              value={tempListDescription}
              onChange={(e) => setTempListDescription(e.target.value)}
              placeholder={"Write instructions for AI agents working in this list...\n\nExample:\nYou help our family plan meals.\n\n## Goals\n- Suggest healthy recipes\n- Create weekly shopping lists\n\n## Guardrails\n- No shellfish (allergy)\n- Budget: $150/week"}
              className="w-full theme-comment-bg theme-border border theme-text-primary rounded-lg px-3 py-2 resize-vertical focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              rows={8}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setTempListDescription(list.description || "")
                  session.cancelEditing(editorId)
                  setShowInstructionPreview(false)
                }
              }}
            />
          )}

          {/* Save / Cancel buttons */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center space-x-1 text-xs theme-text-muted">
              <Bot className="w-3 h-3" />
              <span>Agents receive this as their primary context. Supports markdown.</span>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTempListDescription(list.description || "")
                  session.cancelEditing(editorId)
                  setShowInstructionPreview(false)
                }}
                className="text-xs theme-border theme-text-secondary hover:theme-bg-hover"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  handleSaveListDescription()
                  setShowInstructionPreview(false)
                }}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Check className="w-3 h-3 mr-1" />
                Save
              </Button>
            </div>
          </div>

          {/* Templates */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center space-x-1 text-xs theme-text-muted hover:theme-text-secondary"
            >
              {showTemplates ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <Sparkles className="w-3 h-3" />
              <span>Starter templates</span>
            </button>
            {showTemplates && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {STARTER_TEMPLATES.map((template) => (
                  <button
                    key={template.name}
                    type="button"
                    onClick={() => {
                      setTempListDescription(template.instructions)
                      setShowTemplates(false)
                      setShowInstructionPreview(false)
                    }}
                    className="text-left text-xs p-2 rounded theme-border border hover:theme-bg-hover theme-text-secondary"
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className="theme-text-primary cursor-pointer hover:theme-bg-hover p-2 rounded border border-transparent hover:theme-border min-h-[2.5rem] flex items-start"
          onClick={() => {
            ;(window as unknown as { _lastFocusTime?: number })._lastFocusTime = Date.now()
            session.beginEditing(editorId)
          }}
        >
          {list.description ? (
            <div className="w-full">
              <div
                className="prose prose-sm max-w-none theme-text-primary"
                dangerouslySetInnerHTML={{
                  __html: sanitizeTextToHtml(list.description)
                }}
              />
              <div className="flex items-center space-x-1 text-xs theme-text-muted mt-2">
                <Edit3 className="w-3 h-3" />
                <span>Click to edit</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <span className="theme-text-muted italic">Click to add agent instructions...</span>
              <div className="flex items-center space-x-1 text-xs theme-text-muted">
                <Bot className="w-3 h-3" />
                <span>AI agents use this as their primary guidance when working on tasks in this list</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
