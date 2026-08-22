"use client"

import React from "react"
import { Bell, CheckCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { apiGet, apiPut } from "@/lib/api"
import { NOTIFICATION_KIND_LABELS, type NotificationKind } from "@/lib/notifications"

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

export function NotificationBell() {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)

  const loadNotifications = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiGet("/api/v1/notifications?limit=20")
      if (!response.ok) {
        throw new Error(`Failed to load notifications (${response.status})`)
      }

      const data = (await response.json()) as NotificationResponse
      setNotifications(data.notifications ?? [])
      setUnreadCount(data.unreadCount ?? 0)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications")
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
        throw new Error(`Failed to mark notifications read (${response.status})`)
      }

      await loadNotifications()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update notifications")
    }
  }, [loadNotifications])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative p-2" title="Notifications">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-medium">Notifications</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            Mark all read
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading
            </div>
          ) : error ? (
            <div className="px-3 py-4 text-sm text-destructive">{error}</div>
          ) : notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              You are all caught up.
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
                      <div className="font-medium">{NOTIFICATION_KIND_LABELS[notification.kind]}</div>
                      <div className="truncate text-muted-foreground">
                        {notification.task
                          ? `${notification.task.identifier ? `${notification.task.identifier} · ` : ""}${notification.task.title}`
                          : "Task update"}
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
