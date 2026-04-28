"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TaskCheckbox } from "@/components/task-checkbox"
import { CheckCircle2, Lightbulb, Heart, ArrowLeft, Calendar, ListTodo, Globe, Users, Hash } from "lucide-react"
import { format } from "date-fns"
import { getAllListMembers } from "@/lib/list-member-utils"
import { shouldHideTaskWhen } from "@/lib/public-list-utils"
import type { Task } from "@/types/task"
import { createLogger } from '@/lib/logger'

const log = createLogger('[locale].u.[userId].page.tsx')


interface UserProfile {
  user: {
    id: string
    name: string | null
    email: string
    image: string | null
    createdAt: Date
    isAIAgent?: boolean
    aiAgentType?: string | null
  }
  stats: {
    completed: number
    inspired: number
    supported: number
  }
  sharedTasks: Task[]
  isOwnProfile: boolean
}

export default function UserProfilePage() {
  const params = useParams()
  const router = useRouter()
  const userId = params?.userId as string

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchProfile() {
      try {
        setLoading(true)
        const response = await fetch(`/api/users/${userId}/profile`)

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }))
          log.error({ status: response.status, errorData }, '[User Profile Page] API error')

          if (response.status === 404) {
            setError("User not found")
          } else if (response.status === 401) {
            setError("Please sign in to view user profiles")
          } else {
            setError(`Failed to load user profile: ${errorData.error || "Unknown error"}`)
          }
          return
        }

        const data = await response.json()
        setProfile(data)
      } catch (err) {
        log.error({ err: err }, "Error fetching user profile:")
        setError("Failed to load user profile")
      } finally {
        setLoading(false)
      }
    }

    if (userId) {
      fetchProfile()
    }
  }, [userId])

  if (loading) {
    return (
      <div className="min-h-screen theme-bg-primary flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="theme-text-muted">Loading profile...</p>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen theme-bg-primary flex items-center justify-center p-4">
        <Card className="theme-bg-secondary theme-border border p-8 text-center max-w-md">
          <h1 className="text-2xl font-bold theme-text-primary mb-4">
            {error || "Profile not found"}
          </h1>
          <Button onClick={() => router.back()} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Back
          </Button>
        </Card>
      </div>
    )
  }

  const { user, stats, sharedTasks, isOwnProfile } = profile
  const displayName = user.name || user.email.split("@")[0]
  const userInitial = displayName.charAt(0).toUpperCase()

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 3: return 'rgb(239, 68, 68)' // Red
      case 2: return 'rgb(251, 191, 36)' // Yellow
      case 1: return 'rgb(59, 130, 246)' // Blue
      default: return 'rgb(107, 114, 128)' // Gray
    }
  }

  const handleTaskClick = (task: any) => {
    // Navigate to the main app with the task's primary list selected and task ID in URL
    const primaryListId = task.lists?.[0]?.id
    if (primaryListId) {
      router.push(`/?list=${primaryListId}&task=${task.id}`)
    } else {
      // If no list, just navigate to home
      router.push(`/?task=${task.id}`)
    }
  }

  return (
    <div className="min-h-screen theme-bg-primary">
      {/* Header */}
      <div className="theme-header theme-border app-header">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="p-2 hover:bg-opacity-20"
          >
            <ArrowLeft className="w-5 h-5 theme-text-primary" />
          </Button>
          <div
            className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => router.push('/')}
            title="Go to Home"
          >
            <Heart className="w-6 h-6 text-red-500 fill-red-500" />
            <span className="text-xl font-semibold theme-text-primary">astrid</span>
          </div>
          <div className="flex items-center space-x-1 theme-count-bg rounded-full px-3 py-1">
            <div className="w-2 h-2 theme-bg-tertiary rounded-full"></div>
            <span className="text-sm theme-text-primary">Profile</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* User Info Card */}
        <Card className="theme-bg-secondary theme-border border p-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            {/* Avatar */}
            {user.image ? (
              <img
                src={user.image}
                alt={displayName}
                className="w-24 h-24 sm:w-32 sm:h-32 rounded-full object-cover"
              />
            ) : (
              <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-muted flex items-center justify-center">
                <span className="text-3xl sm:text-4xl font-bold">{userInitial}</span>
              </div>
            )}

            {/* User Details */}
            <div className="flex-1 text-center sm:text-left">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-2 mb-2">
                <h1 className="text-2xl sm:text-3xl font-bold theme-text-primary">
                  {displayName}
                </h1>
                {user.isAIAgent && (
                  <Badge variant="secondary" className="text-xs">
                    AI Agent
                  </Badge>
                )}
              </div>
              <p className="theme-text-muted text-sm mb-3">{user.email}</p>
              <div className="flex items-center justify-center sm:justify-start gap-2 theme-text-muted text-sm">
                <Calendar className="w-4 h-4" />
                <span>Joined {format(new Date(user.createdAt), "MMMM yyyy")}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Completed Tasks */}
          <Card className="theme-bg-secondary theme-border border p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-sm theme-text-muted">Completed</p>
                <p className="text-2xl font-bold theme-text-primary">{stats.completed}</p>
              </div>
            </div>
            <p className="text-xs theme-text-muted mt-2">Tasks completed</p>
          </Card>

          {/* Inspired Tasks */}
          <Card className="theme-bg-secondary theme-border border p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-yellow-500/10 rounded-lg">
                <Lightbulb className="w-6 h-6 text-yellow-500" />
              </div>
              <div>
                <p className="text-sm theme-text-muted">Inspired</p>
                <p className="text-2xl font-bold theme-text-primary">{stats.inspired}</p>
              </div>
            </div>
            <p className="text-xs theme-text-muted mt-2">
              Tasks created, completed or copied by others
            </p>
          </Card>

          {/* Supported Tasks */}
          <Card className="theme-bg-secondary theme-border border p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Heart className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-sm theme-text-muted">Supported</p>
                <p className="text-2xl font-bold theme-text-primary">{stats.supported}</p>
              </div>
            </div>
            <p className="text-xs theme-text-muted mt-2">Comments on others&apos; tasks</p>
          </Card>
        </div>

        {/* Shared Tasks Section */}
        {sharedTasks.length > 0 && (
          <Card className="theme-bg-secondary theme-border border p-6">
            <div className="flex items-center gap-2 mb-4">
              <ListTodo className="w-5 h-5 theme-text-muted" />
              <h2 className="text-lg font-semibold theme-text-primary">
                {isOwnProfile ? "Your Tasks" : `Shared Tasks with ${displayName}`}
              </h2>
              <Badge variant="outline" className="ml-auto">
                {sharedTasks.length}
              </Badge>
            </div>

            {/* Task rows using same format as TaskManager */}
            <div className="space-y-2">
              {sharedTasks.map((task: any) => (
                <div
                  key={task.id}
                  className="task-row transition-theme relative theme-surface theme-surface-hover theme-border cursor-pointer"
                  onClick={() => handleTaskClick(task)}
                >
                  {/* Checkbox for non-completed tasks, or show completed state */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <TaskCheckbox
                      checked={task.completed}
                      onToggle={() => {}} // Read-only in profile
                      priority={task.priority}
                      repeating={task.repeating !== 'never'}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Task title */}
                    <div className={`text-base font-medium leading-tight ${
                      task.completed
                        ? "task-title-completed theme-text-muted line-through"
                        : "theme-text-primary"
                    }`}>
                      {task.title}
                    </div>

                    {/* Lists and due date */}
                    <div className="flex items-center justify-between mt-1 gap-2">
                      <div className="flex flex-wrap gap-1 min-w-0 flex-1">
                        {task.lists && task.lists.length > 0 && (
                          <>
                            {task.lists.slice(0, 2).map((list: any) => (
                              <div
                                key={list.id}
                                className="flex items-center space-x-1 theme-bg-secondary rounded-full px-2 py-0.5 text-xs theme-border border"
                              >
                                {(() => {
                                  const privacy = list?.privacy

                                  if (privacy === 'PUBLIC') {
                                    return <Globe className="w-3 h-3 text-green-500" />
                                  }

                                  const allMembers = getAllListMembers(list)
                                  const hasAdditionalMembers = allMembers.length > 1
                                  if (hasAdditionalMembers) {
                                    return <Users className="w-3 h-3 text-blue-500" />
                                  }

                                  return (
                                    <Hash
                                      className="w-3 h-3 flex-shrink-0"
                                      style={{ color: list.color }}
                                    />
                                  )
                                })()}
                                <span className="theme-text-secondary truncate">{list.name}</span>
                              </div>
                            ))}
                            {task.lists.length > 2 && (
                              <span className="text-xs theme-text-muted">+{task.lists.length - 2}</span>
                            )}
                          </>
                        )}
                      </div>
                      {task.dueDateTime && !shouldHideTaskWhen(task) && (
                        <div className="text-xs theme-text-muted flex-shrink-0">
                          {format(new Date(task.dueDateTime), "MMM d")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* No shared tasks message */}
        {sharedTasks.length === 0 && !isOwnProfile && (
          <Card className="theme-bg-secondary theme-border border p-8 text-center">
            <ListTodo className="w-12 h-12 theme-text-muted mx-auto mb-3 opacity-50" />
            <p className="theme-text-muted">
              No tasks shared with {displayName} yet
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
