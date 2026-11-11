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
const getTimezoneOptions = (t: (key: string, replacements?: Record<string, string>) => string): Array<{ value: string; label: string }> => {
  try {
    const currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    
    // Predefined timezone options
    const predefinedTimezones = [
      { value: "UTC", label: "UTC" },
      { value: "America/New_York", label: t('reminderSettings.timezones.eastern') },
      { value: "America/Los_Angeles", label: t('reminderSettings.timezones.pacific') },
      { value: "America/Chicago", label: t('reminderSettings.timezones.central') },
      { value: "America/Denver", label: t('reminderSettings.timezones.mountain') },
      { value: "Europe/London", label: t('reminderSettings.timezones.london') },
      { value: "Europe/Paris", label: t('reminderSettings.timezones.paris') },
      { value: "Asia/Tokyo", label: t('reminderSettings.timezones.tokyo') },
    ]
    
    // Check if current timezone is already in the list
    const currentExists = predefinedTimezones.some(tz => tz.value === currentTimezone)
    
    if (currentExists) {
      // Update the existing entry to show it's local
      return predefinedTimezones.map(tz => 
        tz.value === currentTimezone 
          ? { ...tz, label: t('reminderSettings.timezones.local', { label: tz.label }) }
          : tz
      )
    } else {
      // Add current timezone at the top if it's not in the list
      return [
        { value: currentTimezone, label: t('reminderSettings.timezones.local', { label: currentTimezone }) },
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
          title: t('messages.error'),
          description: t('reminderSettings.toast.loadFailed'),
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error loading reminder settings:", error)
      toast({
        title: t('messages.error'),
        description: t('reminderSettings.toast.loadFailed'),
        duration: 5000,
      })
    } finally {
      setLoading(false)
    }
    // `t` is a new function on every render; listing it would reload in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          title: t('reminderSettings.toast.savedTitle'),
          description: t('reminderSettings.toast.savedDescription'),
          duration: 3000,
        })
      } else {
        const error = await response.json()
        toast({
          title: t('messages.error'),
          description: error.error || t('reminderSettings.toast.saveFailed'),
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error saving reminder settings:", error)
      toast({
        title: t('messages.error'),
        description: t('reminderSettings.toast.saveFailed'),
        duration: 5000,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleRequestNotificationPermission = async () => {
    if (!notificationState.isSupported) {
      toast({
        title: t('reminderSettings.toast.notSupportedTitle'),
        description: t('reminderSettings.toast.notSupportedDescription'),
        duration: 5000,
      })
      return
    }

    try {
      const permission = await Notification.requestPermission()
      setNotificationState(prev => ({ ...prev, permission }))

      if (permission === "granted") {
        toast({
          title: t('reminderSettings.toast.permissionGrantedTitle'),
          description: t('reminderSettings.toast.permissionGrantedDescription'),
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
              title: t('reminderSettings.toast.subscriptionFailedTitle'),
              description: t('reminderSettings.toast.subscriptionFailedDescription'),
              duration: 5000,
            })
          }
        }
      } else if (permission === "denied") {
        toast({
          title: t('reminderSettings.toast.permissionDeniedTitle'),
          description: t('reminderSettings.toast.permissionDeniedDescription'),
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error requesting notification permission:", error)
      toast({
        title: t('messages.error'),
        description: t('reminderSettings.toast.permissionRequestFailed'),
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
          title: t('reminderSettings.toast.testScheduledTitle'),
          description: data.message,
          duration: 5000,
        })
      } else {
        toast({
          title: t('reminderSettings.toast.testFailedTitle'),
          description: data.error || t('reminderSettings.toast.testScheduleFailed'),
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error testing notification:", error)
      toast({
        title: t('messages.error'),
        description: t('reminderSettings.toast.testFailed'),
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
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const getReminderTimeOptions = () => [
    { value: 0, label: t('time.atDueTime') },
    { value: 15, label: t('time.minutesBefore', { count: '15' }) },
    { value: 30, label: t('time.minutesBefore', { count: '30' }) },
    { value: 60, label: t('time.hourBefore') },
    { value: 120, label: t('time.twoHoursBefore') },
    { value: 360, label: t('time.hoursBefore', { count: '6' }) },
    { value: 720, label: t('time.hoursBefore', { count: '12' }) },
    { value: 1440, label: t('time.dayBefore') },
    { value: 2880, label: t('time.twoDaysBefore') },
    { value: 7200, label: t('time.weekBefore') }
  ]

  return (
    <Card className="theme-bg-secondary theme-border">
      <CardHeader>
        <CardTitle className="theme-text-primary flex items-center space-x-2">
          <Bell className="w-5 h-5" />
          <span>{t('reminderSettings.title')}</span>
        </CardTitle>
        <CardDescription className="theme-text-muted">
          {t('reminderSettings.description')}
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
                {t('reminderSettings.pushDescription')}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              {notificationState.permission === "granted" && (
                <CheckCircle className="w-4 h-4 text-success" />
              )}
              {notificationState.permission === "denied" && (
                <AlertCircle className="w-4 h-4 text-danger" />
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
              {t('reminderSettings.enablePush')}
            </Button>
          )}

          {notificationState.permission === "denied" && (
            <div className="text-xs theme-text-muted bg-danger-subtle p-2 rounded">
              {t('reminderSettings.pushBlocked')}
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
              {testing === "push_notification" ? t('reminderSettings.testing') : t('reminderSettings.testPush')}
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
              {t('reminderSettings.emailDescription')}
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
            {t('reminderSettings.defaultReminderTimeDescription')}
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
                {t('reminderSettings.dailyDigestDescription')}
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
                    label={t('reminderSettings.digestTime')}
                    compact
                  />
                </div>
                <div className="space-y-2">
                  <Label className="theme-text-secondary text-sm">{t('settings.timezone.title')}</Label>
                  <Select
                    value={settings.dailyDigestTimezone}
                    onValueChange={(value) => updateSetting("dailyDigestTimezone", value)}
                    disabled={saving}
                  >
                    <SelectTrigger className="theme-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getTimezoneOptions(t).map((option) => (
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
                {testing === "daily_digest" ? t('reminderSettings.testing') : t('reminderSettings.testDigest')}
              </Button>
            </div>
          )}
        </div>

        {/* Quiet Hours */}
        <div className="space-y-3 pt-4 border-t">
          <div className="space-y-1">
            <Label className="theme-text-secondary">{t('reminderSettings.quietHours')}</Label>
            <p className="text-sm theme-text-muted">
              {t('reminderSettings.quietHoursDescription')}
            </p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <TimePicker
                mode="string"
                value={settings.quietHoursStart || undefined}
                onChange={(time) => updateSetting("quietHoursStart", typeof time === "string" ? time : "")}
                placeholder="10pm"
                label={t('reminderSettings.quietStart')}
                compact
              />
            </div>
            <div className="space-y-2">
              <TimePicker
                mode="string"
                value={settings.quietHoursEnd || undefined}
                onChange={(time) => updateSetting("quietHoursEnd", typeof time === "string" ? time : "")}
                placeholder="8am"
                label={t('reminderSettings.quietEnd')}
                compact
              />
            </div>
          </div>
        </div>

        {saving && (
          <div className="flex items-center justify-center py-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand"></div>
            <span className="ml-2 text-sm theme-text-muted">{t('settingsPages.profileInfo.saving')}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}