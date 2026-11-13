"use client"

import { BRAND } from '@/lib/brand/config'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { Bell, Clock, X, CheckCircle, AlertCircle, Calendar, Users } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'
import { formatDateAtTime, formatRelativeFromNow } from '@/lib/i18n/date-format'
import { getRandomReminderString } from '@/lib/reminder-constants'
import { apiPut } from '@/lib/api'
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
  const { t, locale, messages } = useTranslations()
  const [isSnoozing, setIsSnoozing] = useState(false)
  const [isDismissing, setIsDismissing] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const isOverdue = dueDateTime && new Date(dueDateTime) < new Date()
  const [quote] = useState(() =>
    isOverdue
      ? getRandomReminderString('reminders_due', locale, messages)
      : getRandomReminderString('reminder_responses', locale, messages)
  )
  const isSharedList = collaborators.length > 0

  const handleSnooze = async (minutes: number) => {
    try {
      setIsSnoozing(true)
      
      const response = await fetch(`/api/v1/reminders/${reminderId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
      })

      if (response.ok) {
        const result = await response.json()
        toast({
          title: t('reminders.ui.snoozedTitle'),
          description: t('reminders.ui.snoozedDescription', { when: formatRelativeFromNow(minutes * 60 * 1000, locale) }),
          duration: 3000,
        })
        onSnooze(minutes)
      } else {
        const error = await response.json()
        throw new Error(error.error || t('reminders.ui.snoozeFailed'))
      }
    } catch (error) {
      console.error('Error snoozing reminder:', error)
      toast({
        title: t('reminders.ui.snoozeFailedTitle'),
        description: error instanceof Error ? error.message : t('reminders.ui.snoozeFailed'),
        duration: 5000,
      })
    } finally {
      setIsSnoozing(false)
    }
  }

  const handleDismiss = async () => {
    try {
      setIsDismissing(true)
      
      const response = await fetch(`/api/v1/reminders/${reminderId}/dismiss`, {
        method: 'POST',
      })

      if (response.ok) {
        toast({
          title: t('reminders.ui.dismissedTitle'),
          description: t('reminders.ui.dismissedDescription'),
          duration: 3000,
        })
        onDismiss()
      } else {
        const error = await response.json()
        throw new Error(error.error || t('reminders.ui.dismissFailed'))
      }
    } catch (error) {
      console.error('Error dismissing reminder:', error)
      toast({
        title: t('reminders.ui.dismissFailedTitle'),
        description: error instanceof Error ? error.message : t('reminders.ui.dismissFailed'),
        duration: 5000,
      })
    } finally {
      setIsDismissing(false)
    }
  }

  const handleMarkComplete = async () => {
    try {
      setIsCompleting(true)
      
      // Mark task as complete.
      //
      // v1, not legacy, and PUT, not PATCH. `/api/tasks/[id]` exports only
      // GET/PUT/DELETE, so the PATCH this used to send was a 405 and the
      // button never once completed a task. Legacy PUT is no good either — it
      // rejects a body with no title, and this sends only `completed`.
      // `PUT /api/v1/tasks/[id]` does partial updates. (Task cde681e4)
      //
      // apiPut, not fetch: completing a task from a reminder is exactly the
      // write most likely to be made on a phone with no signal, and a raw
      // fetch loses it (task b8b21855).
      // No `response.ok` branch: apiPut throws an ApiError carrying the
      // server's message, so failure arrives in the catch below.
      await apiPut(`/api/v1/tasks/${taskId}`, { completed: true })

      toast({
        title: t('reminders.ui.completedTitle'),
        description: t('reminders.ui.completedDescription'),
        duration: 3000,
      })

      // Also dismiss the reminder
      await handleDismiss()

      if (onComplete) {
        onComplete()
      }
    } catch (error) {
      console.error('Error completing task:', error)
      toast({
        title: t('reminders.ui.completeFailedTitle'),
        description: error instanceof Error ? error.message : t('reminders.ui.completeFailed'),
        duration: 5000,
      })
    } finally {
      setIsCompleting(false)
    }
  }

  const getReminderIcon = () => {
    if (type === 'daily_digest') {
      return <Calendar className="w-5 h-5 text-brand" />
    }
    if (isOverdue) {
      return <AlertCircle className="w-5 h-5 text-danger" />
    }
    return <Bell className="w-5 h-5 text-warning" />
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
              className="flex-shrink-0 w-6 h-6 rounded border-2 border-theme hover:border-brand transition-colors flex items-center justify-center"
            >
              {isCompleting ? (
                <div className="w-4 h-4 border-2 border-theme-focus border-t-transparent rounded-full animate-spin" />
              ) : null}
            </button>

            {/* Task Name and Due Date */}
            <div className="flex-1 min-w-0">
              <div className="theme-text-primary font-medium truncate">{taskTitle}</div>
              {dueDateTime && (
                <div className={`text-sm flex items-center space-x-1 ${isOverdue ? 'text-overdue' : 'theme-text-muted'}`}>
                  <Clock className="w-3 h-3" />
                  <span>{formatDateAtTime(new Date(dueDateTime), locale, t)}</span>
                  {isOverdue && <span className="font-semibold">• {t('reminders.ui.overdue')}</span>}
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
                <div className="absolute -left-3 top-6 w-0 h-0 border-t-[12px] border-t-transparent border-r-[16px] border-r-theme border-b-[12px] border-b-transparent"></div>
                <div className="absolute -left-[10px] top-[27px] w-0 h-0 border-t-[9px] border-t-transparent border-r-[13px] border-b-[9px] border-b-transparent speech-bubble-arrow-fill"></div>
                <p className="text-base font-semibold theme-text-primary leading-relaxed">{quote}</p>
              </div>
            </div>
          </div>

          {/* Collaborators (if shared list) */}
          {isSharedList && (
            <div className="bg-warning-subtle border border-warning/30 rounded-lg p-3">
              <div className="flex items-center space-x-2">
                <div className="flex -space-x-2">
                  {collaborators.slice(0, 5).map((collab) => {
                    const initials = collab.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
                    return (
                      <div
                        key={collab.id}
                        className="w-8 h-8 rounded-full bg-brand text-brand-foreground flex items-center justify-center text-xs font-semibold border-2 border-theme-card"
                        title={collab.name}
                      >
                        {initials}
                      </div>
                    )
                  })}
                  {collaborators.length > 5 && (
                    <div className="w-8 h-8 rounded-full bg-theme-active text-theme-secondary flex items-center justify-center text-xs font-semibold border-2 border-theme-card">
                      +{collaborators.length - 5}
                    </div>
                  )}
                </div>
                <p className="text-sm font-medium text-theme-primary">
                  {t('reminders.social.multiple')} 🤝
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
              className="w-full bg-success hover:bg-success/90 text-success-foreground font-semibold py-6 text-base"
            >
              <CheckCircle className="w-5 h-5 mr-2" />
              {t('reminders.ui.complete')}
            </Button>

            {/* Snooze Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => handleSnooze(1440)}
                disabled={isSnoozing}
                className="py-6 text-base font-semibold"
              >
                {t('reminders.ui.snooze1day')}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSnooze(10080)}
                disabled={isSnoozing}
                className="py-6 text-base font-semibold"
              >
                {t('reminders.ui.snooze1week')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
