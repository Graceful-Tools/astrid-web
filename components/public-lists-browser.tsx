"use client"

import React, { useState, useEffect, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  Search,
  Copy,
  User,
  Calendar,
  CheckSquare,
  Eye,
  Globe,
  Clock,
  ListTodo,
  Star,
  ArrowLeft,
  X
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface PublicList {
  id: string
  name: string
  description: string | null
  color: string
  imageUrl: string | null
  createdAt: string
  owner: {
    id: string
    name: string | null
    email: string
  }
  _count: {
    tasks: number
  }
  copyCount?: number
}

interface PublicListPreview extends PublicList {
  tasks: Array<{
    id: string
    title: string
    description: string
    priority: number
    completed: boolean
    dueDateTime: string | null
    createdAt: string
  }>
}

interface PublicListsBrowserProps {
  isOpen: boolean
  onClose: () => void
  onListCopied?: (copiedList: any) => void
}

export function PublicListsBrowser({ isOpen, onClose, onListCopied }: PublicListsBrowserProps) {
  const [publicLists, setPublicLists] = useState<PublicList[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [selectedList, setSelectedList] = useState<PublicListPreview | null>(null)
  const [copying, setCopying] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [filterBy, setFilterBy] = useState<'all' | 'popular' | 'recent'>('all')
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'preview'>('list')
  const [isMobile, setIsMobile] = useState(false)
  const { toast } = useToast()

  // Detect mobile layout
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Get copy count bucket label
  const getCopyCountBucket = (count: number = 0): string => {
    if (count >= 5000) return `${count.toLocaleString()} copies`
    if (count >= 1000) return "> 1,000 copies"
    if (count >= 500) return "> 500 copies"
    if (count >= 100) return "> 100 copies"
    if (count >= 50) return "> 50 copies"
    if (count >= 10) return "> 10 copies"
    if (count >= 5) return "> 5 copies"
    if (count > 0) return `${count} ${count === 1 ? 'copy' : 'copies'}`
    return "New"
  }

  // Get copy count color
  const getCopyCountColor = (count: number = 0): string => {
    if (count >= 1000) return "text-purple-600 dark:text-purple-400 font-bold"
    if (count >= 100) return "text-blue-600 dark:text-blue-400 font-semibold"
    if (count >= 10) return "text-green-600 dark:text-green-400"
    if (count >= 5) return "text-gray-600 dark:text-gray-400"
    return "text-gray-500 dark:text-gray-500"
  }

  // Fetch public lists
  const fetchPublicLists = useCallback(async (query?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set("q", query)
      params.set("limit", "50")
      if (filterBy === 'popular') params.set("sortBy", "copyCount")
      if (filterBy === 'recent') params.set("sortBy", "recent")
      if (selectedCreator) params.set("ownerId", selectedCreator)

      // Stays on legacy: v1's /api/v1/public/lists is a projection that emits
      // taskCount and memberCount, while this browser reads list._count,
      // list.copyCount and selectedList.tasks. Swapping it would blank the
      // task counts and the copy count with no error. (641a7615 step 3)
      const response = await fetch(`/api/lists/public?${params}`)
      if (response.ok) {
        const data = await response.json()
        setPublicLists(data.lists || [])
      } else {
        console.error("Failed to fetch public lists")
        toast({
          title: "Error",
          description: "Failed to load public lists",
          variant: "destructive"
        })
      }
    } catch (error) {
      console.error("Error fetching public lists:", error)
      toast({
        title: "Error",
        description: "Failed to load public lists",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }, [toast, filterBy, selectedCreator])

  // Load preview for a list
  const loadListPreview = useCallback(async (listId: string) => {
    setPreviewLoading(true)
    try {
      const response = await fetch(`/api/lists/${listId}/preview`)
      if (response.ok) {
        const data = await response.json()
        setSelectedList(data.list)
        if (isMobile) {
          setMobileView('preview')
        }
      } else {
        toast({
          title: "Error",
          description: "Failed to load list preview",
          variant: "destructive"
        })
      }
    } catch (error) {
      console.error("Error loading list preview:", error)
      toast({
        title: "Error",
        description: "Failed to load list preview",
        variant: "destructive"
      })
    } finally {
      setPreviewLoading(false)
    }
  }, [toast, isMobile])

  // Copy a list
  const copyList = useCallback(async (listId: string, listName: string) => {
    setCopying(listId)
    try {
      const response = await fetch(`/api/v1/lists/${listId}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeTasks: true,
          preserveTaskAssignees: false
        })
      })

      if (response.ok) {
        const data = await response.json()
        toast({
          title: "Success!",
          description: data.message || `Copied "${listName}" to your lists`,
        })
        onListCopied?.(data.list)
        onClose()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to copy list",
          variant: "destructive"
        })
      }
    } catch (error) {
      console.error("Error copying list:", error)
      toast({
        title: "Error",
        description: "Failed to copy list",
        variant: "destructive"
      })
    } finally {
      setCopying(null)
    }
  }, [toast, onListCopied, onClose])

  // Search with debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPublicLists(searchQuery || undefined)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, fetchPublicLists])

  // Initial load and when filters change
  useEffect(() => {
    if (isOpen) {
      fetchPublicLists(searchQuery)
      setSelectedList(null)
    }
  }, [isOpen, filterBy, selectedCreator, fetchPublicLists, searchQuery])

  // Initial reset when opening
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("")
      setFilterBy('all')
      setSelectedCreator(null)
      setSelectedList(null)
      setMobileView('list')
    }
  }, [isOpen])

  // Handle mobile back navigation
  const handleMobileBack = useCallback(() => {
    if (mobileView === 'preview') {
      setMobileView('list')
      setSelectedList(null)
    } else {
      onClose()
    }
  }, [mobileView, onClose])

  const getPriorityBadge = (priority: number) => {
    switch (priority) {
      case 3: return <Badge variant="destructive" className="text-xs">High</Badge>
      case 2: return <Badge variant="secondary" className="text-xs">Medium</Badge>
      case 1: return <Badge variant="outline" className="text-xs">Low</Badge>
      default: return null
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={`theme-bg-primary w-full h-full flex flex-col ${
        !isMobile ? 'max-w-6xl max-h-[85vh] mx-4 rounded-lg theme-border border shadow-xl' : ''
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 theme-border border-b">
          <div className="flex items-center gap-3">
            {isMobile && mobileView === 'preview' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMobileBack}
                className="theme-text-secondary hover:theme-text-primary p-2"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <Globe className="w-5 h-5 theme-text-primary" />
            <h2 className="text-xl font-semibold theme-text-primary">
              {isMobile && mobileView === 'preview' && selectedList
                ? selectedList.name
                : 'Browse Public Lists'
              }
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={isMobile && mobileView === 'preview' ? handleMobileBack : onClose}
            className="theme-text-muted hover:theme-text-primary p-2"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content Area */}
        <div className={`flex-1 overflow-hidden ${
          isMobile ? 'flex flex-col' : 'flex gap-6'
        }`}>
          {/* List Browser Panel */}
          <div className={`${
            isMobile
              ? `${mobileView === 'list' ? 'flex flex-col' : 'hidden'}`
              : 'w-2/5 flex flex-col'
          }`}>
            {/* Search and Filters */}
            <div className="p-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 theme-text-muted w-4 h-4" />
                <Input
                  placeholder="Search by name, description, or creator..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 theme-input theme-text-primary"
                />
              </div>

              {/* Filter buttons */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant={filterBy === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterBy('all')}
                  className="text-xs"
                >
                  All Lists
                </Button>
                <Button
                  variant={filterBy === 'popular' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterBy('popular')}
                  className="text-xs"
                >
                  <Star className="w-3 h-3 mr-1" />
                  Popular
                </Button>
                <Button
                  variant={filterBy === 'recent' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterBy('recent')}
                  className="text-xs"
                >
                  <Clock className="w-3 h-3 mr-1" />
                  Recent
                </Button>
              </div>
            </div>

            {/* Lists */}
            <div className="flex-1 theme-bg-secondary rounded-lg theme-border border overflow-y-auto mx-4 mb-4">
              <div className="p-4 space-y-3">
                {loading ? (
                  <div className="text-center py-8 theme-text-muted">
                    Loading public lists...
                  </div>
                ) : publicLists.length === 0 ? (
                  <div className="text-center py-8 theme-text-muted">
                    {searchQuery ? "No lists found" : "No public lists available"}
                  </div>
                ) : (
                  publicLists.map((list) => (
                    <div
                      key={list.id}
                      className={`p-3 rounded-lg theme-border border cursor-pointer transition-all ${
                        selectedList?.id === list.id
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                          : "theme-bg-primary hover:theme-bg-hover"
                      }`}
                      onClick={() => loadListPreview(list.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {list.imageUrl && (
                              <img
                                src={list.imageUrl}
                                alt=""
                                className="w-4 h-4 rounded object-cover"
                              />
                            )}
                            <h3 className="font-medium theme-text-primary truncate">
                              {list.name}
                            </h3>
                          </div>

                          {list.description && (
                            <p className="text-sm theme-text-muted line-clamp-2 mb-1">
                              {list.description}
                            </p>
                          )}

                          {/* Copy count bucket display */}
                          <div className={`text-xs ${getCopyCountColor(list.copyCount)} mb-2`}>
                            <Copy className="w-3 h-3 inline mr-1" />
                            Copied {getCopyCountBucket(list.copyCount)}
                          </div>

                          <div className="flex items-center gap-3 text-xs theme-text-muted">
                            <div className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {list.owner.name || list.owner.email}
                            </div>
                            <div className="flex items-center gap-1">
                              <ListTodo className="w-3 h-3" />
                              {list._count.tasks} tasks
                            </div>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation()
                            copyList(list.id, list.name)
                          }}
                          disabled={copying === list.id}
                          className="ml-2 shrink-0"
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          {copying === list.id ? "Copying..." : "Copy"}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Preview Panel */}
          <div className={`${
            isMobile
              ? `${mobileView === 'preview' ? 'flex flex-col' : 'hidden'}`
              : 'w-3/5 flex flex-col'
          }`}>
            {selectedList ? (
              <>
                {/* Preview Header */}
                <div className="theme-bg-secondary rounded-lg theme-border border p-4 m-4 mb-2">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {selectedList.imageUrl && (
                        <img
                          src={selectedList.imageUrl}
                          alt=""
                          className="w-8 h-8 rounded object-cover"
                        />
                      )}
                      <div>
                        <h2 className="text-xl font-semibold theme-text-primary">
                          {selectedList.name}
                        </h2>
                        <div className="flex items-center gap-2 text-sm theme-text-muted">
                          <User className="w-4 h-4" />
                          Created by {selectedList.owner.name || selectedList.owner.email}
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={() => copyList(selectedList.id, selectedList.name)}
                      disabled={copying === selectedList.id}
                      className="bg-blue-600 hover:bg-blue-700 text-white shrink-0"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      {copying === selectedList.id ? "Copying..." : isMobile ? "Copy" : "Copy to My Lists"}
                    </Button>
                  </div>

                  {selectedList.description && (
                    <p className="theme-text-muted mb-3">{selectedList.description}</p>
                  )}

                  <div className="flex items-center gap-4 text-sm theme-text-muted flex-wrap">
                    <div className="flex items-center gap-1">
                      <ListTodo className="w-4 h-4" />
                      {selectedList._count.tasks} tasks
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      Created {formatDate(selectedList.createdAt)}
                    </div>
                    {selectedList.copyCount && (
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4" />
                        {selectedList.copyCount} copies
                      </div>
                    )}
                  </div>
                </div>

                {/* Tasks Preview */}
                <div className="flex-1 theme-bg-secondary rounded-lg theme-border border overflow-hidden mx-4 mb-4">
                  <div className="p-4 theme-border border-b">
                    <h3 className="font-medium theme-text-primary">Tasks Preview</h3>
                    <p className="text-sm theme-text-muted">
                      {selectedList.tasks.length > 0
                        ? `Showing ${selectedList.tasks.length} of ${selectedList._count.tasks} tasks`
                        : "No tasks in this list"
                      }
                    </p>
                  </div>

                  <div className={`overflow-y-auto ${isMobile ? 'h-[50vh]' : 'h-[400px]'}`}>
                    <div className="p-4 space-y-2">
                      {previewLoading ? (
                        <div className="text-center py-8 theme-text-muted">
                          Loading preview...
                        </div>
                      ) : selectedList.tasks.length === 0 ? (
                        <div className="text-center py-8 theme-text-muted">
                          This list has no tasks
                        </div>
                      ) : (
                        selectedList.tasks.map((task) => (
                          <div key={task.id} className="p-3 theme-bg-primary rounded theme-border border">
                            <div className="flex items-start gap-2">
                              <CheckSquare className={`w-4 h-4 mt-0.5 ${
                                task.completed ? "text-green-600" : "theme-text-muted"
                              }`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className={`font-medium ${
                                    task.completed ? "line-through theme-text-muted" : "theme-text-primary"
                                  }`}>
                                    {task.title}
                                  </span>
                                  {getPriorityBadge(task.priority)}
                                </div>

                                {task.description && (
                                  <p className="text-sm theme-text-muted line-clamp-2 mb-1">
                                    {task.description}
                                  </p>
                                )}

                                <div className="flex items-center gap-2 text-xs theme-text-muted flex-wrap">
                                  {task.dueDateTime && (
                                    <div className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      Due {formatDate(task.dueDateTime)}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    Created {formatDate(task.createdAt)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              !isMobile && (
                <div className="flex-1 flex items-center justify-center theme-bg-secondary rounded-lg theme-border border mx-4 my-4">
                  <div className="text-center">
                    <Eye className="w-12 h-12 theme-text-muted mx-auto mb-4" />
                    <h3 className="text-lg font-medium theme-text-primary mb-2">
                      Select a List to Preview
                    </h3>
                    <p className="theme-text-muted">
                      Choose a list from the left to see its details and tasks
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}