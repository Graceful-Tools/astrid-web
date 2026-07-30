"use client"

import { BRAND } from '@/lib/brand/config'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { Bell, Clock, X, CheckCircle, AlertCircle, Calendar, Users } from 'lucide-react'
import { format } from 'date-fns'
import { getRandomReminderString } from '@/lib/reminder-constants'
import Image from 'next/image'

interface ReminderNotificationProps {
  reminderId: string
  taskTitle: string
  taskId: string
  scheduledFor: Date
  type: 'due_reminder' | 'daily_digest'
  dueDateTime?: Date | null
  listNames?: string[]
  collaborators?: Array<{
    id: string
    name: string
    email: string
  }>
  onDismiss: () => void
  onSnooze: (minutes: number) => void
  onComplete?: () => void
}

const snoozeOptions = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 480, label: '8 hours' },
  { value: 1440, label: '1 day' },
]

export function ReminderNotification({
  reminderId,
  taskTitle,
  taskId,
  scheduledFor,
  type,
  dueDateTime,
  listNames = [],
  collaborators = [],
  onDismiss,
  onSnooze,
  onComplete,
}: ReminderNotificationProps) {
  const { toast } = useToast()
  const [isSnoozing, setIsSnoozing] = useState(false)
  const [isDismissing, setIsDismissing] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const isOverdue = dueDateTime && new Date(dueDateTime) < new Date()
  const [quote] = useState(() =>
    isOverdue
      ? getRandomReminderString('reminders_due')
      : getRandomReminderString('reminder_responses')
  )
  const timeUntilDue = dueDateTime ? getTimeUntilDue(dueDateTime) : null
  const isSharedList = collaborators.length > 0

  const handleSnooze = async (minutes: number) => {
    try {
      setIsSnoozing(true)
      
      const response = await fetch(`/api/reminders/${reminderId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
      })

      if (response.ok) {
        const result = await response.json()
        toast({
          title: 'Reminder Snoozed',
          description: `Reminder will come back in ${formatSnoozeTime(minutes)}`,
          duration: 3000,
        })
        onSnooze(minutes)
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Failed to snooze reminder')
      }
    } catch (error) {
      console.error('Error snoozing reminder:', error)
      toast({
        title: 'Snooze Failed',
        description: error instanceof Error ? error.message : 'Failed to snooze reminder',
        duration: 5000,
      })
    } finally {
      setIsSnoozing(false)
    }
  }

  const handleDismiss = async () => {
    try {
      setIsDismissing(true)
      
      const response = await fetch(`/api/reminders/${reminderId}/dismiss`, {
        method: 'POST',
      })

      if (response.ok) {
        toast({
          title: 'Reminder Dismissed',
          description: 'This reminder will not appear again',
          duration: 3000,
        })
        onDismiss()
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Failed to dismiss reminder')
      }
    } catch (error) {
      console.error('Error dismissing reminder:', error)
      toast({
        title: 'Dismiss Failed',
        description: error instanceof Error ? error.message : 'Failed to dismiss reminder',
        duration: 5000,
      })
    } finally {
      setIsDismissing(false)
    }
  }

  const handleMarkComplete = async () => {
    try {
      setIsCompleting(true)
      
      // Mark task as complete
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: true }),
      })

      if (response.ok) {
        toast({
          title: 'Task Completed',
          description: 'Task marked as complete and reminder dismissed',
          duration: 3000,
        })
        
        // Also dismiss the reminder
        await handleDismiss()
        
        if (onComplete) {
          onComplete()
        }
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Failed to complete task')
      }
    } catch (error) {
      console.error('Error completing task:', error)
      toast({
        title: 'Complete Failed',
        description: error instanceof Error ? error.message : 'Failed to complete task',
        duration: 5000,
      })
    } finally {
      setIsCompleting(false)
    }
  }

  const getReminderIcon = () => {
    if (type === 'daily_digest') {
      return <Calendar className="w-5 h-5 text-blue-500" />
    }
    if (isOverdue) {
      return <AlertCircle className="w-5 h-5 text-red-500" />
    }
    return <Bell className="w-5 h-5 text-orange-500" />
  }

  const getReminderTitle = () => {
    if (type === 'daily_digest') {
      return 'Daily Task Digest'
    }
    if (isOverdue) {
      return 'Task Overdue'
    }
    return 'Task Reminder'
  }

  const getReminderDescription = () => {
    if (type === 'daily_digest') {
      return 'Your daily task summary is ready'
    }
    if (isOverdue) {
      return `${taskTitle} is overdue`
    }
    if (timeUntilDue) {
      return `${taskTitle} is due ${timeUntilDue}`
    }
    return `${taskTitle} is due`
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <Card className="theme-bg-primary theme-border w-full max-w-lg shadow-2xl">
        <CardContent className="p-6 space-y-6">
          {/* Task Row - Exactly like a task */}
          <div className="flex items-center space-x-3 p-3 theme-bg-secondary rounded-lg border theme-border">
            {/* Checkbox */}
            <button
              onClick={handleMarkComplete}
              disabled={isCompleting}
              className="flex-shrink-0 w-6 h-6 rounded border-2 theme-border hover:border-blue-500 transition-colors flex items-center justify-center"
            >
              {isCompleting ? (
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              ) : null}
            </button>

            {/* Task Name and Due Date */}
            <div className="flex-1 min-w-0">
              <div className="theme-text-primary font-medium truncate">{taskTitle}</div>
              {dueDateTime && (
                <div className={`text-sm flex items-center space-x-1 ${isOverdue ? 'text-red-600 dark:text-red-400' : 'theme-text-muted'}`}>
                  <Clock className="w-3 h-3" />
                  <span>{format(dueDateTime, "MMM d 'at' h:mm a")}</span>
                  {isOverdue && <span className="font-semibold">• Overdue</span>}
                </div>
              )}
            </div>

            {/* Dismiss button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              disabled={isDismissing}
              className="flex-shrink-0 p-1 h-auto opacity-60 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Astrid with Speech Bubble */}
          <div className="flex items-start space-x-4">
            {/* Astrid Icon - 1/3 of screen width */}
            <div className="flex-shrink-0" style={{ width: '33%' }}>
              <Image
                src={BRAND.icon}
                alt={BRAND.appName}
                width={200}
                height={200}
                className="w-full h-auto"
              />
            </div>

            {/* Speech Bubble */}
            <div className="flex-1">
              <div className="relative theme-bg-secondary rounded-2xl p-4 border-2 theme-border shadow-lg">
                {/* Comic-style speech bubble pointer */}
                <div className="absolute -left-3 top-6 w-0 h-0 border-t-[12px] border-t-transparent border-r-[16px] border-r-gray-300 dark:border-r-gray-600 border-b-[12px] border-b-transparent"></div>
                <div className="absolute -left-[10px] top-[27px] w-0 h-0 border-t-[9px] border-t-transparent border-r-[13px] border-b-[9px] border-b-transparent speech-bubble-arrow-fill"></div>
                <p className="text-base font-semibold theme-text-primary leading-relaxed">{quote}</p>
              </div>
            </div>
          </div>

          {/* Collaborators (if shared list) */}
          {isSharedList && (
            <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
              <div className="flex items-center space-x-2">
                <div className="flex -space-x-2">
                  {collaborators.slice(0, 5).map((collab) => {
                    const initials = collab.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
                    return (
                      <div
                        key={collab.id}
                        className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-semibold border-2 border-white dark:border-gray-800"
                        title={collab.name}
                      >
                        {initials}
                      </div>
                    )
                  })}
                  {collaborators.length > 5 && (
                    <div className="w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center text-xs font-semibold border-2 border-white dark:border-gray-800">
                      +{collaborators.length - 5}
                    </div>
                  )}
                </div>
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  These people are counting on you! 🤝
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3">
            {/* Complete Button */}
            <Button
              onClick={handleMarkComplete}
              disabled={isCompleting}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-6 text-base"
            >
              <CheckCircle className="w-5 h-5 mr-2" />
              Complete
            </Button>

            {/* Snooze Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => handleSnooze(1440)}
                disabled={isSnoozing}
                className="py-6 text-base font-semibold"
              >
                Snooze 1 day
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSnooze(10080)}
                disabled={isSnoozing}
                className="py-6 text-base font-semibold"
              >
                Snooze 1 week
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Helper functions
function getTimeUntilDue(dueDateTime: Date): string {
  const due = new Date(dueDateTime)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  
  if (diffMs <= 0) return 'now'

  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 0) {
    return `in ${diffDays} day${diffDays !== 1 ? 's' : ''}`
  } else if (diffHours > 0) {
    return `in ${diffHours} hour${diffHours !== 1 ? 's' : ''}`
  } else if (diffMinutes > 0) {
    return `in ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`
  } else {
    return 'now'
  }
}

function formatSnoozeTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minutes`
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60)
    return `${hours} hour${hours !== 1 ? 's' : ''}`
  } else {
    const days = Math.floor(minutes / 1440)
    return `${days} day${days !== 1 ? 's' : ''}`
  }
}