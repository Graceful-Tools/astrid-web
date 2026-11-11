"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { AlertTriangle, Users, Crown, Shield, Trash2, X, Check } from "lucide-react"
import type { TaskList } from "@/types/task"

interface OwnerLeaveDialogProps {
  list: TaskList
  members: any[]
  currentUser: any
  open: boolean
  onClose: () => void
  onTransferAndLeave: (successorId: string) => void
  onDeleteList: () => void
}

export function OwnerLeaveDialog({
  list,
  members,
  currentUser,
  open,
  onClose,
  onTransferAndLeave,
  onDeleteList
}: OwnerLeaveDialogProps) {
  const [selectedSuccessor, setSelectedSuccessor] = useState<string>("")
  const [isProcessing, setIsProcessing] = useState(false)

  if (!open) return null

  // Filter out the current user and get potential successors
  const potentialSuccessors = members.filter(m => 
    m.user_id !== currentUser.id && m.type === 'member'
  ).sort((a, b) => {
    // Prioritize admins first
    if (a.role === 'admin' && b.role !== 'admin') return -1
    if (b.role === 'admin' && a.role !== 'admin') return 1
    return 0
  })

  const handleTransfer = async () => {
    if (!selectedSuccessor) return
    setIsProcessing(true)
    await onTransferAndLeave(selectedSuccessor)
    setIsProcessing(false)
  }

  const handleDelete = async () => {
    setIsProcessing(true)
    await onDeleteList()
    setIsProcessing(false)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
      <Card className="theme-bg-primary theme-border w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <h2 className="text-lg font-semibold theme-text-primary">Transfer Ownership</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-theme-muted hover:text-theme-primary p-1"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <p className="text-sm theme-text-secondary">
            As the owner of &quot;<strong>{list.name}</strong>&quot;, you need to transfer ownership before leaving. 
            Choose a successor or delete the list.
          </p>

          {potentialSuccessors.length > 0 ? (
            <>
              <div>
                <Label className="text-sm theme-text-secondary mb-3 block">
                  Select New Owner:
                </Label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {potentialSuccessors.map((member) => (
                    <div 
                      key={member.user_id} 
                      className={`flex items-center space-x-3 p-2 rounded cursor-pointer border transition-all ${
                        selectedSuccessor === member.user_id 
                          ? 'border-brand bg-theme-selected' 
                          : 'border-theme-surface hover:theme-bg-hover'
                      }`}
                      onClick={() => setSelectedSuccessor(member.user_id)}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        selectedSuccessor === member.user_id 
                          ? 'border-brand bg-brand' 
                          : 'border-theme-input'
                      }`}>
                        {selectedSuccessor === member.user_id && (
                          <Check className="w-3 h-3 text-white" />
                        )}
                      </div>
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={member.image || undefined} />
                        <AvatarFallback className="text-xs">
                          {member.name?.charAt(0) || member.email?.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm theme-text-primary truncate">
                            {member.name || member.email}
                          </span>
                          {member.role === 'admin' ? (
                            <Shield className="w-3 h-3 text-brand" />
                          ) : (
                            <Users className="w-3 h-3 text-theme-muted" />
                          )}
                        </div>
                        <span className="text-xs theme-text-muted">
                          {member.role === 'admin' ? 'Admin' : 'Member'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex space-x-3">
                <Button
                  onClick={handleTransfer}
                  disabled={!selectedSuccessor || isProcessing}
                  className="flex-1 bg-brand hover:bg-brand-hover text-brand-foreground"
                >
                  <Crown className="w-4 h-4 mr-2" />
                  Transfer & Leave
                </Button>
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={isProcessing}
                  className="theme-border"
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm theme-text-secondary mb-4">
                No other members to transfer ownership to.
              </p>
            </div>
          )}

          <div className="border-t theme-border pt-4">
            <p className="text-xs theme-text-muted mb-3">
              Alternatively, you can delete the list entirely:
            </p>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isProcessing}
              className="w-full hover:text-danger hover:bg-danger-subtle"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete List
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}