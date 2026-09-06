"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "@/lib/i18n/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Bell, Clock, Mail, Smartphone, AlertCircle, CheckCircle } from "lucide-react"
import { TimePicker } from "@/components/ui/time-picker"
import type { ReminderSettings, ReminderSettingsForm, NotificationPermissionState } from "@/types/reminder"

interface ReminderSettingsComponentProps {
  onSettingsChange?: (settings: ReminderSettings) => void
}

// Convert minutes to human readable format
const formatReminderTime = (minutes: number): string => {
  if (minutes === 0) return "At due time"
  if (minutes < 60) return `${minutes} min before`
  if (minutes === 60) return "1 hour before" 
  if (minutes < 1440) return `${Math.round(minutes / 60)} hours before`
  return `${Math.round(minutes / 1440)} days before`
}

// Get timezone options
const getTimezoneOptions = (): Array<{ value: string; label: string }> => {
  try {
    const currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    
    // Predefined timezone options
    const predefinedTimezones = [
      { value: "UTC", label: "UTC" },
      { value: "America/New_York", label: "Eastern Time" },
      { value: "America/Los_Angeles", label: "Pacific Time" },
      { value: "America/Chicago", label: "Central Time" },
      { value: "America/Denver", label: "Mountain Time" },
      { value: "Europe/London", label: "London" },
      { value: "Europe/Paris", label: "Paris" },
      { value: "Asia/Tokyo", label: "Tokyo" },
    ]
    
    // Check if current timezone is already in the list
    const currentExists = predefinedTimezones.some(tz => tz.value === currentTimezone)
    
    if (currentExists) {
      // Update the existing entry to show it's local
      return predefinedTimezones.map(tz => 
        tz.value === currentTimezone 
          ? { ...tz, label: `${tz.label} (Local)` }
          : tz
      )
    } else {
      // Add current timezone at the top if it's not in the list
      return [
        { value: currentTimezone, label: `${currentTimezone} (Local)` },
        ...predefinedTimezones
      ]
    }
  } catch {
    return [{ value: "UTC", label: "UTC" }]
  }
}

export function ReminderSettingsComponent({ onSettingsChange }: ReminderSettingsComponentProps) {
  const { t } = useTranslations()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [settings, setSettings] = useState<ReminderSettingsForm | null>(null)
  const [notificationState, setNotificationState] = useState<NotificationPermissionState>({
    permission: "default",
    isSupported: false,
    isServiceWorkerSupported: false
  })

  // Check notification support and permission
  useEffect(() => {
    const checkNotificationSupport = () => {
      const isSupported = "Notification" in window
      const isServiceWorkerSupported = "serviceWorker" in navigator
      const permission = isSupported ? Notification.permission : "denied"

      setNotificationState({
        permission: permission as NotificationPermission,
        isSupported,
        isServiceWorkerSupported
      })
    }

    checkNotificationSupport()
  }, [])

  const loadReminderSettings = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/v1/users/me/reminder-settings")
      
      if (response.ok) {
        const data = await response.json()
        setSettings({
          enablePushReminders: data.enablePushReminders,
          enableEmailReminders: data.enableEmailReminders,
          defaultReminderTime: data.defaultReminderTime,
          enableDailyDigest: data.enableDailyDigest,
          dailyDigestTime: data.dailyDigestTime,
          dailyDigestTimezone: data.dailyDigestTimezone,
          quietHoursStart: data.quietHoursStart || "",
          quietHoursEnd: data.quietHoursEnd || "",
        })
        
        if (onSettingsChange) {
          onSettingsChange(data)
        }
      } else {
        toast({
          title: "Error",
          description: "Failed to load reminder settings.",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error loading reminder settings:", error)
      toast({
        title: "Error",
        description: "Failed to load reminder settings.",
        duration: 5000,
      })
    } finally {
      setLoading(false)
    }
  }, [toast, onSettingsChange])

  // Load reminder settings
  useEffect(() => {
    loadReminderSettings()
  }, [loadReminderSettings])

  const saveReminderSettings = async (newSettings: ReminderSettingsForm) => {
    try {
      setSaving(true)
      
      // Prepare data for API
      const apiData = {
        ...newSettings,
        quietHoursStart: newSettings.quietHoursStart || null,
        quietHoursEnd: newSettings.quietHoursEnd || null,
      }

      const response = await fetch("/api/v1/users/me/reminder-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiData),
      })

      if (response.ok) {
        const savedSettings = await response.json()
        setSettings(newSettings)
        
        if (onSettingsChange) {
          onSettingsChange(savedSettings)
        }
        
        toast({
          title: "Settings Saved",
          description: "Your reminder preferences have been updated.",
          duration: 3000,
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to save reminder settings.",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error saving reminder settings:", error)
      toast({
        title: "Error",
        description: "Failed to save reminder settings.",
        duration: 5000,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleRequestNotificationPermission = async () => {
    if (!notificationState.isSupported) {
      toast({
        title: "Not Supported",
        description: "Push notifications are not supported in this browser.",
        duration: 5000,
      })
      return
    }

    try {
      const permission = await Notification.requestPermission()
      setNotificationState(prev => ({ ...prev, permission }))

      if (permission === "granted") {
        toast({
          title: "Permission Granted",
          description: "You'll now receive push notifications for your tasks.",
          duration: 3000,
        })

        // Subscribe to push notifications
        if ("serviceWorker" in navigator) {
          try {
            const registration = await navigator.serviceWorker.ready
            const subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
            })

            // Send subscription to server
            await fetch("/api/v1/users/me/push-subscriptions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                endpoint: subscription.endpoint,
                keys: {
                  p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")!))),
                  auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("auth")!)))
                },
                userAgent: navigator.userAgent
              }),
            })
          } catch (subscriptionError) {
            console.error("Failed to subscribe to push notifications:", subscriptionError)
            toast({
              title: "Subscription Failed",
              description: "Failed to set up push notifications. Email notifications will still work.",
              duration: 5000,
            })
          }
        }
      } else if (permission === "denied") {
        toast({
          title: "Permission Denied",
          description: "Push notifications are blocked. You can enable them in your browser settings.",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error requesting notification permission:", error)
      toast({
        title: "Error",
        description: "Failed to request notification permission.",
        duration: 5000,
      })
    }
  }

  const testNotification = async (type: "daily_digest" | "push_notification") => {
    try {
      setTesting(type)
      
      const response = await fetch("/api/debug/test-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      })

      const data = await response.json()

      if (response.ok) {
        toast({
          title: "Test Scheduled",
          description: data.message,
          duration: 5000,
        })
      } else {
        toast({
          title: "Test Failed",
          description: data.error || "Failed to schedule test notification.",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error testing notification:", error)
      toast({
        title: "Error",
        description: "Failed to test notification.",
        duration: 5000,
      })
    } finally {
      setTesting(null)
    }
  }

  const updateSetting = <K extends keyof ReminderSettingsForm>(
    key: K,
    value: ReminderSettingsForm[K]
  ) => {
    if (!settings) return
    
    const newSettings = { ...settings, [key]: value }
    saveReminderSettings(newSettings)
  }

  if (loading || !settings) {
    return (
      <Card className="theme-bg-secondary theme-border">
        <CardHeader>
          <CardTitle className="theme-text-primary flex items-center space-x-2">
            <Bell className="w-5 h-5" />
            <span>{t('reminderSettings.title')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const getReminderTimeOptions = () => [
    { value: 0, label: "At due time" },
    { value: 15, label: "15 minutes before" },
    { value: 30, label: "30 minutes before" },
    { value: 60, label: "1 hour before" },
    { value: 120, label: "2 hours before" },
    { value: 360, label: "6 hours before" },
    { value: 720, label: "12 hours before" },
    { value: 1440, label: "1 day before" },
    { value: 2880, label: "2 days before" },
    { value: 7200, label: "1 week before" }
  ]

  return (
    <Card className="theme-bg-secondary theme-border">
      <CardHeader>
        <CardTitle className="theme-text-primary flex items-center space-x-2">
          <Bell className="w-5 h-5" />
          <span>{t('reminderSettings.title')}</span>
        </CardTitle>
        <CardDescription className="theme-text-muted">
          Configure when and how you receive task reminders
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Push Notifications */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="theme-text-secondary flex items-center space-x-2">
                <Smartphone className="w-4 h-4" />
                <span>{t('reminderSettings.pushNotifications')}</span>
              </Label>
              <p className="text-sm theme-text-muted">
                Receive instant notifications in your browser
              </p>
            </div>
            <div className="flex items-center space-x-2">
              {notificationState.permission === "granted" && (
                <CheckCircle className="w-4 h-4 text-green-500" />
              )}
              {notificationState.permission === "denied" && (
                <AlertCircle className="w-4 h-4 text-red-500" />
              )}
              <Switch
                checked={settings.enablePushReminders && notificationState.permission === "granted"}
                onCheckedChange={(checked) => {
                  if (checked && notificationState.permission !== "granted") {
                    handleRequestNotificationPermission()
                  } else {
                    updateSetting("enablePushReminders", checked)
                  }
                }}
                disabled={!notificationState.isSupported || saving}
              />
            </div>
          </div>
          
          {notificationState.permission === "default" && (
            <Button
              onClick={handleRequestNotificationPermission}
              size="sm"
              variant="outline"
              className="w-full"
            >
              Enable Push Notifications
            </Button>
          )}

          {notificationState.permission === "denied" && (
            <div className="text-xs theme-text-muted bg-red-50 dark:bg-red-900/20 p-2 rounded">
              Push notifications are blocked. Enable them in your browser settings to receive task reminders.
            </div>
          )}

          {settings.enablePushReminders && notificationState.permission === "granted" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => testNotification("push_notification")}
              disabled={testing === "push_notification" || saving}
              className="w-full text-xs mt-2"
            >
              {testing === "push_notification" ? "Testing..." : "Test Push Notification (5min delay)"}
            </Button>
          )}
        </div>

        {/* Email Notifications */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="theme-text-secondary flex items-center space-x-2">
              <Mail className="w-4 h-4" />
              <span>{t('reminderSettings.emailReminders')}</span>
            </Label>
            <p className="text-sm theme-text-muted">
              Receive reminder emails for due tasks
            </p>
          </div>
          <Switch
            checked={settings.enableEmailReminders}
            onCheckedChange={(checked) => updateSetting("enableEmailReminders", checked)}
            disabled={saving}
          />
        </div>

        {/* Default Reminder Time */}
        <div className="space-y-2">
          <Label className="theme-text-secondary flex items-center space-x-2">
            <Clock className="w-4 h-4" />
            <span>{t('reminderSettings.defaultReminderTime')}</span>
          </Label>
          <p className="text-sm theme-text-muted">
            When to remind you before tasks are due
          </p>
          <Select
            value={settings.defaultReminderTime.toString()}
            onValueChange={(value) => updateSetting("defaultReminderTime", parseInt(value))}
            disabled={saving}
          >
            <SelectTrigger className="theme-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {getReminderTimeOptions().map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Daily Digest */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="theme-text-secondary">{t('reminderSettings.dailyDigest')}</Label>
              <p className="text-sm theme-text-muted">
                Get a daily summary of your tasks
              </p>
            </div>
            <Switch
              checked={settings.enableDailyDigest}
              onCheckedChange={(checked) => updateSetting("enableDailyDigest", checked)}
              disabled={saving}
            />
          </div>

          {settings.enableDailyDigest && (
            <div className="space-y-4 ml-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <TimePicker
                    mode="string"
                    value={settings.dailyDigestTime || undefined}
                    onChange={(time) => updateSetting("dailyDigestTime", typeof time === "string" ? time : "")}
                    placeholder="8am"
                    label="Time"
                    compact
                  />
                </div>
                <div className="space-y-2">
                  <Label className="theme-text-secondary text-sm">Timezone</Label>
                  <Select
                    value={settings.dailyDigestTimezone}
                    onValueChange={(value) => updateSetting("dailyDigestTimezone", value)}
                    disabled={saving}
                  >
                    <SelectTrigger className="theme-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getTimezoneOptions().map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* Debug Test Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => testNotification("daily_digest")}
                disabled={testing === "daily_digest" || saving}
                className="w-full text-xs"
              >
                {testing === "daily_digest" ? "Testing..." : "Test Daily Digest (5min delay)"}
              </Button>
            </div>
          )}
        </div>

        {/* Quiet Hours */}
        <div className="space-y-3 pt-4 border-t">
          <div className="space-y-1">
            <Label className="theme-text-secondary">{t('reminderSettings.quietHours')}</Label>
            <p className="text-sm theme-text-muted">
              Disable notifications during these hours (optional)
            </p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <TimePicker
                mode="string"
                value={settings.quietHoursStart || undefined}
                onChange={(time) => updateSetting("quietHoursStart", typeof time === "string" ? time : "")}
                placeholder="10pm"
                label="Start"
                compact
              />
            </div>
            <div className="space-y-2">
              <TimePicker
                mode="string"
                value={settings.quietHoursEnd || undefined}
                onChange={(time) => updateSetting("quietHoursEnd", typeof time === "string" ? time : "")}
                placeholder="8am"
                label="End"
                compact
              />
            </div>
          </div>
        </div>

        {saving && (
          <div className="flex items-center justify-center py-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            <span className="ml-2 text-sm theme-text-muted">Saving...</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}