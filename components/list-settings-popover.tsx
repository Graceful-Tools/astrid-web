"use client"

import React, { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ListSortAndFilters } from "./list-sort-and-filters"
import { ListMembership } from "./list-membership"
import { ListAdminSettings } from "./list-admin-settings"
import type { TaskList, User } from "../types/task"
import { Lock, Unlock, X, Filter, Users, Settings } from "lucide-react"

interface ListSettingsPopoverProps {
  list: TaskList
  currentUser: User
  availableUsers: User[]
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
  onFavoriteToggle?: (listId: string) => void
  onDelete: (listId: string) => void
  onLeave?: (list: TaskList, isOwnerLeaving?: boolean) => void
  onEditName?: () => void
  onEditImage?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
  // No longer need local filter props as they will be loaded from database
}

export function ListSettingsPopover({
  list,
  currentUser,
  availableUsers,
  canEditSettings,
  onUpdate,
  onFavoriteToggle,
  onDelete,
  onLeave,
  onEditName,
  onEditImage,
  open = false,
  onOpenChange = () => {},
  children,
  // No longer need local filter props
}: ListSettingsPopoverProps) {
  const [activeTab, setActiveTab] = useState("sort-filters")
  const [mounted, setMounted] = useState(false)

  // Wait for component to mount before rendering portal
  useEffect(() => {
    setMounted(true)
  }, [])

  // Ensure activeTab is valid for non-admin users
  React.useEffect(() => {
    if (!canEditSettings && activeTab === "admin") {
      setActiveTab("sort-filters")
    }
  }, [canEditSettings, activeTab])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onOpenChange(false)
    }
  }

  const modalContent = open && (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center md:items-center md:justify-center"
      style={{ zIndex: 9999 }}
      onKeyDown={handleKeyDown}
      onClick={() => onOpenChange(false)}
      tabIndex={-1}
    >
          <Card
            className="theme-bg-primary theme-border w-full h-full md:h-auto md:max-w-2xl md:mx-4 md:rounded-lg p-0 shadow-lg rounded-none md:shadow-lg flex flex-col"
            style={{ position: 'relative', zIndex: 10000 }}
            onClick={(e) => e.stopPropagation()}
          >
          {/* Header */}
          <div className="p-4 border-b theme-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-semibold theme-text-primary">
                  {canEditSettings ? "List Settings" : "List Details"}
                </h2>
                {list.privacy === "PRIVATE" ? <Lock className="w-4 h-4 theme-text-muted" /> : <Unlock className="w-4 h-4 theme-text-muted" />}
              </div>
              <div className="flex items-center space-x-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="theme-text-muted hover:theme-text-primary p-1"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Content with Tabs */}
          <div className="flex-1 md:max-h-96 overflow-y-auto">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className={`grid w-full ${canEditSettings ? 'grid-cols-3' : 'grid-cols-2'} theme-bg-secondary`}>
                <TabsTrigger value="sort-filters" className="flex items-center space-x-1 text-xs">
                  <Filter className="w-3 h-3" />
                  <span>Sort & Filters</span>
                </TabsTrigger>
                <TabsTrigger value="membership" className="flex items-center space-x-1 text-xs">
                  <Users className="w-3 h-3" />
                  <span>Membership</span>
                </TabsTrigger>
                {canEditSettings && (
                  <TabsTrigger value="admin" className="flex items-center space-x-1 text-xs">
                    <Settings className="w-3 h-3" />
                    <span>Admin Settings</span>
                  </TabsTrigger>
                )}
              </TabsList>

              <div className="p-4 pb-40 md:pb-4">
                <TabsContent value="sort-filters" className="mt-0">
                  <ListSortAndFilters
                    list={list}
                    currentUser={currentUser}
                    onUpdate={onUpdate}
                    onFavoriteToggle={onFavoriteToggle}
                  />
                </TabsContent>

                <TabsContent value="membership" className="mt-0">
                  <ListMembership
                    list={list}
                    currentUser={currentUser}
                    canEditSettings={canEditSettings}
                    onUpdate={onUpdate}
                    onLeave={(list, isOwnerLeaving) => {
                      if (onLeave) {
                        onLeave(list, isOwnerLeaving)
                        onOpenChange(false)
                      }
                    }}
                  />
                </TabsContent>

                {canEditSettings && (
                  <TabsContent value="admin" className="mt-0">
                    <ListAdminSettings
                      list={list}
                      currentUser={currentUser}
                      canEditSettings={canEditSettings}
                      onUpdate={onUpdate}
                      onDelete={(listId) => {
                        onDelete(listId)
                        onOpenChange(false)
                      }}
                      onEditName={onEditName}
                      onEditImage={onEditImage}
                    />
                  </TabsContent>
                )}
              </div>
            </Tabs>
          </div>
          </Card>
        </div>
  )

  // Use portal to render modal at document.body level to avoid z-index issues
  return (
    <>
      {mounted && modalContent && typeof document !== 'undefined'
        ? createPortal(modalContent, document.body)
        : null
      }
    </>
  )
}