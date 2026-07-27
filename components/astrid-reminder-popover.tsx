"use client"

import { BRAND } from '@/lib/brand/config'
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { X, Clock, CheckCircle, Globe, Users } from "lucide-react"
import { Task, User } from "@/types/task"
import { getRandomReminderString, getSocialAccountabilityMessage } from "@/lib/reminder-constants"
import { getAllListMembers } from "@/lib/list-member-utils"
import { useToast } from "@/hooks/use-toast"
import { TaskCheckbox } from "@/components/task-checkbox"
import { format } from "date-fns"
import { useTranslations } from "@/lib/i18n/client"

interface AstridReminderPopoverProps {
  task: Task
  onComplete: (taskId: string) => void
  onSnooze: (taskId: string, snoozeMinutes: number) => void
  onDismiss: () => void
  currentUser: User
}

export function AstridReminderPopover({ 
  task, 
  onComplete, 
  onSnooze, 
  onDismiss,
  currentUser
}: AstridReminderPopoverProps) {
  const [astridPhrase, setAstridPhrase] = useState("")
  const [reminderType, setReminderType] = useState<"general" | "due">("general")
  const { toast } = useToast()
  const { t, tArray, locale, messages } = useTranslations()

  useEffect(() => {
    if (!messages) return

    // Determine reminder type based on task due date
    const isDue = task.dueDateTime && new Date(task.dueDateTime) <= new Date()
    const type = isDue ? "due" : "general"
    setReminderType(type)
    
    // Get random Astrid phrase based on type
    const phraseType = isDue ? "reminders_due" : "reminders"
    const randomPhrase = getRandomReminderString(phraseType, locale, messages)
    const responsePhrase = getRandomReminderString("reminder_responses", locale, messages)
    
    // Combine phrases for full Astrid experience
    setAstridPhrase(`${randomPhrase} ${responsePhrase}`)
  }, [task, locale, messages])

  // Get shared list members for social accountability
  const getSharedListMembers = (): User[] => {
    if (!task.lists || task.lists.length === 0) return []

    const members: User[] = []
    task.lists.forEach(list => {
      if (list.privacy === "SHARED") {
        const allListMembers = getAllListMembers(list)
        allListMembers.forEach(member => {
          // Don't include current user
          if (member.id !== currentUser.id) {
            members.push({
              id: member.id,
              name: member.name,
              email: member.email,
              image: member.image,
              createdAt: new Date(),
              updatedAt: new Date(),
              emailVerified: null,
              isActive: true,
              pendingEmail: null,
              emailVerificationToken: null,
              emailTokenExpiresAt: null,
              password: null
            } as User)
          }
        })
      }
    })
    
    // Remove duplicates
    const uniqueMembers = members.filter((member, index, self) => 
      index === self.findIndex(m => m.id === member.id)
    )
    
    return uniqueMembers.slice(0, 4) // Limit to 4 faces
  }

  const sharedMembers = getSharedListMembers()
  const socialMessage = sharedMembers.length > 0 && messages
    ? getSocialAccountabilityMessage(
        sharedMembers.map(user => ({
          name: user.name || undefined,
          email: user.email
        })),
        locale,
        messages
      )
    : ""

  const handleComplete = () => {
    onComplete(task.id)
    toast({
      title: "🎉 " + t("reminders.ui.completedToast"),
      duration: 3000,
    })
    onDismiss()
  }

  const handleSnooze = (minutes: number) => {
    onSnooze(task.id, minutes)
    onDismiss()
  }

  const isOverdue = task.dueDateTime && new Date(task.dueDateTime) <= new Date()

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="theme-bg-primary theme-border w-full max-w-lg shadow-2xl rounded-lg overflow-hidden">
        <div className="p-6 space-y-6">
          {/* Task Row - Exactly like a task */}
          <div className="flex items-center space-x-3 p-3 theme-bg-secondary rounded-lg border theme-border">
            {/* Checkbox - using real TaskCheckbox component */}
            <TaskCheckbox
              checked={task.completed}
              onToggle={handleComplete}
              priority={task.priority || 0}
              repeating={task.repeating !== 'never'}
            />

            {/* Task Name and Lists */}
            <div className="flex-1 min-w-0">
              <div className="theme-text-primary font-medium">{task.title}</div>

              {/* List badges - exactly like task row */}
              {task.lists && task.lists.length > 0 && (
                <div className="flex items-center justify-between mt-1 gap-2">
                  <div className="flex flex-wrap gap-1 min-w-0 flex-1">
                    {task.lists.slice(0, 2).map((list) => (
                      <div
                        key={list.id}
                        className="flex items-center space-x-1 theme-bg-secondary rounded-full px-2 py-0.5 text-xs theme-border border"
                      >
                        {(() => {
                          const privacy = list?.privacy

                          // Check if list is PUBLIC first
                          if (privacy === 'PUBLIC') {
                            return <Globe className="w-3 h-3 text-green-500" />
                          }

                          // Check if list is SHARED
                          const allMembers = getAllListMembers(list)
                          const hasAdditionalMembers = allMembers.length > 1
                          if (hasAdditionalMembers) {
                            return <Users className="w-3 h-3 text-blue-500" />
                          }

                          // Default to private - show colored dot
                          return (
                            <div
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: list.color }}
                            />
                          )
                        })()}
                        <span className="theme-text-secondary truncate">{list.name}</span>
                      </div>
                    ))}
                    {task.lists.length > 2 && (
                      <span className="text-xs theme-text-muted">+{task.lists.length - 2}</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Due Date on the right - exactly like task row */}
            {task.dueDateTime && (
              <div className="text-xs theme-text-muted flex-shrink-0">
                {format(new Date(task.dueDateTime), "MMM d")}
              </div>
            )}

            {/* Dismiss button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="flex-shrink-0 p-1 h-auto opacity-60 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Astrid with Speech Bubble */}
          <div className="flex items-start space-x-4">
            {/* Astrid Icon - 1/3 of screen width */}
            <div className="flex-shrink-0" style={{ width: '33%' }}>
              <img
                src="/icons/icon-512x512.png"
                alt={BRAND.appName}
                className="w-full h-auto"
              />
            </div>

            {/* Speech Bubble */}
            <div className="flex-1">
              <div className="relative theme-bg-secondary rounded-2xl p-4 border-2 theme-border shadow-lg z-0">
                {/* Comic-style speech bubble pointer - outer border (points left toward Astrid) */}
                <div className="absolute -left-[16px] top-6 w-0 h-0 border-t-[12px] border-t-transparent border-r-[16px] border-r-gray-300 dark:border-r-gray-600 border-b-[12px] border-b-transparent border-l-0 z-10"></div>
                {/* Inner pointer fill (covers outer to create border effect) */}
                <div className="absolute -left-[12px] top-[27px] w-0 h-0 border-t-[9px] border-t-transparent border-r-[13px] border-b-[10px] border-b-transparent border-l-0 z-10 speech-bubble-arrow-fill"></div>
                <p className="text-base font-semibold theme-text-primary leading-relaxed">{astridPhrase}</p>
              </div>
            </div>
          </div>

          {/* Collaborators (if shared list) */}
          {sharedMembers.length > 0 && (
            <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
              <div className="flex items-center space-x-2">
                <div className="flex -space-x-2">
                  {sharedMembers.map((member) => {
                    const initials = (member.name || member.email).charAt(0).toUpperCase()
                    return (
                      <div
                        key={member.id}
                        className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-semibold border-2 border-white dark:border-gray-800"
                        title={member.name || member.email}
                      >
                        {initials}
                      </div>
                    )
                  })}
                </div>
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  {socialMessage}
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3">
            {/* Complete Button */}
            <Button
              onClick={handleComplete}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-6 text-base"
            >
              <CheckCircle className="w-5 h-5 mr-2" />
              {t("reminders.ui.complete")}
            </Button>

            {/* Snooze Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => handleSnooze(1440)}
                className="py-6 text-base font-semibold"
              >
                {t("reminders.ui.snooze1day")}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSnooze(10080)}
                className="py-6 text-base font-semibold"
              >
                {t("reminders.ui.snooze1week")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
