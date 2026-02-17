"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { X, Plus, Bot, FileText } from "lucide-react"
import type { User } from "@/types/task"

interface AddListModalProps {
  onClose: () => void
  onCreateList: (listData: {
    name: string
    description: string
    memberEmails: string[]
  }) => void
  currentUser: User
}

export function AddListModal({ onClose, onCreateList, currentUser }: AddListModalProps) {
  const [listName, setListName] = useState("")
  const [description, setDescription] = useState("")
  const [memberInput, setMemberInput] = useState("")
  const [memberEmails, setMemberEmails] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)

  const handleAddMember = () => {
    const email = memberInput.trim()
    if (email && email.includes('@') && !memberEmails.includes(email)) {
      setMemberEmails([...memberEmails, email])
      setMemberInput("")
    }
  }

  const handleMemberKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddMember()
    }
  }

  const handleRemoveMember = (emailToRemove: string) => {
    setMemberEmails(memberEmails.filter(email => email !== emailToRemove))
  }

  const handleCreateList = async () => {
    if (!listName.trim()) return

    setIsCreating(true)
    try {
      await onCreateList({
        name: listName.trim(),
        description: description.trim(),
        memberEmails
      })
      onClose()
    } catch (error) {
      console.error('Error creating list:', error)
    } finally {
      setIsCreating(false)
    }
  }

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
        className="theme-bg-primary theme-border w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold theme-text-primary">Add a List</h2>
            <p className="text-sm theme-text-muted mt-1">
              Use lists to organize projects, goals, and adventures!
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="theme-text-muted hover:theme-text-primary"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* List Name */}
          <div>
            <Label htmlFor="listName" className="theme-text-secondary text-sm font-medium">
              List name
            </Label>
            <Input
              id="listName"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="e.g., Family"
              className="theme-input theme-text-primary mt-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && listName.trim()) {
                  handleCreateList()
                }
              }}
            />
          </div>

          {/* Agent Instructions (Description) */}
          <div>
            <Label htmlFor="description" className="theme-text-secondary text-sm font-medium flex items-center space-x-1.5">
              <FileText className="w-4 h-4" />
              <span>Description / Agent Instructions</span>
              <span className="text-xs theme-text-muted font-normal">(optional)</span>
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={"What's this list for?\n\nAI agents use this as guidance when working on tasks. Example:\n\"Help plan meals, suggest recipes based on dietary preferences, and create shopping lists.\""}
              className="theme-input theme-text-primary mt-1 resize-none text-sm"
              rows={4}
            />
            <div className="flex items-center space-x-1 text-xs theme-text-muted mt-1">
              <Bot className="w-3 h-3" />
              <span>AI agents use this as instructions when working on tasks in this list</span>
            </div>
          </div>

          {/* Share With */}
          <div>
            <Label className="theme-text-secondary text-sm font-medium">
              Share with
            </Label>
            <div className="mt-1 space-y-2">
              <div className="flex space-x-2">
                <Input
                  value={memberInput}
                  onChange={(e) => setMemberInput(e.target.value)}
                  onKeyDown={handleMemberKeyDown}
                  placeholder="Name or e-mail address"
                  className="theme-input theme-text-primary flex-1"
                />
                <Button
                  onClick={handleAddMember}
                  disabled={!memberInput.trim() || !memberInput.includes('@')}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4"
                >
                  Add
                </Button>
              </div>
              
              {/* Member List */}
              {memberEmails.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {memberEmails.map((email) => (
                    <div
                      key={email}
                      className="flex items-center space-x-2 theme-pill-bg px-3 py-1 rounded-full text-sm"
                    >
                      <span className="theme-text-primary">{email}</span>
                      <button
                        onClick={() => handleRemoveMember(email)}
                        className="theme-text-muted hover:theme-text-primary"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex space-x-3 mt-8">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 theme-border theme-text-secondary hover:theme-bg-hover"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateList}
            disabled={!listName.trim() || isCreating}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isCreating ? "Creating..." : "Create new list"}
          </Button>
        </div>
      </Card>

    </div>
  )
}