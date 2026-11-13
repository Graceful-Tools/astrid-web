"use client"

import { useTranslations } from "@/lib/i18n/client"
import React from "react"
import { Bell, CheckCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { apiGet, apiPut } from "@/lib/api"
import type { NotificationKind } from "@/lib/notifications"

const NOTIFICATION_KIND_KEYS: Record<NotificationKind, string> = {
  assigned: "notificationBell.kinds.assigned",
  mentioned: "notificationBell.kinds.mentioned",
  replied: "notificationBell.kinds.replied",
  commented: "notificationBell.kinds.commented",
  status_changed: "notificationBell.kinds.statusChanged",
  completed: "tasks.completed",
}

type NotificationItem = {
  id: string
  kind: NotificationKind
  readAt: string | null
  createdAt: string
  task?: {
    id: string
    identifier: string | null
    title: string
    completed: boolean
  } | null
}

type NotificationResponse = {
  notifications: NotificationItem[]
  unreadCount: number
}

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

type NotificationBellProps = {
  /** Popover alignment against the bell. "start" opens rightward — use it at the left edge of the screen. */
  align?: "start" | "center" | "end"
  /** Trigger button classes, so the bell can match the controls beside it. */
  className?: string
  /** Bell icon classes. */
  iconClassName?: string
}

export function NotificationBell({ align = "end", className, iconClassName }: NotificationBellProps = {}) {
  const { t } = useTranslations()
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  // A message key (plus the HTTP status, when there is one), translated at render.
  const [error, setError] = React.useState<{ key: string; status?: string } | null>(null)

  const loadNotifications = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiGet("/api/v1/notifications?limit=20")
      if (!response.ok) {
        setError({ key: "notificationBell.loadFailedStatus", status: String(response.status) })
        return
      }

      const data = (await response.json()) as NotificationResponse
      setNotifications(data.notifications ?? [])
      setUnreadCount(data.unreadCount ?? 0)
      setError(null)
    } catch {
      setError({ key: "notificationBell.loadFailed" })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadNotifications()
  }, [loadNotifications])

  React.useEffect(() => {
    if (!open) return
    void loadNotifications()
  }, [open, loadNotifications])

  const markAllRead = React.useCallback(async () => {
    try {
      const response = await apiPut("/api/v1/notifications", { all: true })

      if (!response.ok) {
        setError({ key: "notificationBell.markReadFailedStatus", status: String(response.status) })
        return
      }

      await loadNotifications()
    } catch {
      setError({ key: "notificationBell.updateFailed" })
    }
  }, [loadNotifications])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("relative p-2", className)} title={t('settings.notifications')}>
          <Bell className={cn("h-5 w-5", iconClassName)} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-caption2 font-medium text-danger-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-popover-wide p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-medium">{t('settings.notifications')}</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            {t('notificationBell.markAllRead')}
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('messages.loading')}
            </div>
          ) : error ? (
            <div className="px-3 py-4 text-sm text-danger">{t(error.key, error.status ? { status: error.status } : undefined)}</div>
          ) : notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t('notificationBell.allCaughtUp')}
            </div>
          ) : (
            <ul className="divide-y">
              {notifications.map(notification => (
                <li
                  key={notification.id}
                  className={cn(
                    "px-3 py-3 text-sm",
                    notification.readAt ? "bg-background" : "bg-muted/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{t(NOTIFICATION_KIND_KEYS[notification.kind])}</div>
                      <div className="truncate text-muted-foreground">
                        {notification.task
                          ? `${notification.task.identifier ? `${notification.task.identifier} · ` : ""}${notification.task.title}`
                          : t('notificationBell.taskUpdate')}
                      </div>
                    </div>
                    <div className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatCreatedAt(notification.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
