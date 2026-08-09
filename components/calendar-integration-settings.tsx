"use client"

import { BRAND } from '@/lib/brand/config'
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Calendar, Download, ExternalLink, RefreshCw } from "lucide-react"
import type { ReminderSettings } from "@/types/reminder"

interface CalendarIntegrationSettingsProps {}

export function CalendarIntegrationSettings({}: CalendarIntegrationSettingsProps) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<ReminderSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/v1/users/me/reminder-settings")
      if (response.ok) {
        const data = await response.json()
        setSettings(data)
      }
    } catch (error) {
      console.error("Error loading calendar settings:", error)
    } finally {
      setLoading(false)
    }
  }

  const updateSetting = async (field: keyof ReminderSettings, value: any) => {
    if (!settings) return

    setSaving(true)
    try {
      const response = await fetch("/api/v1/users/me/reminder-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })

      if (response.ok) {
        const data = await response.json()
        setSettings(data)
        toast({
          title: "Settings Updated",
          description: "Calendar integration settings have been saved.",
          duration: 3000,
        })
      } else {
        throw new Error("Failed to update settings")
      }
    } catch (error) {
      console.error("Error updating calendar settings:", error)
      toast({
        title: "Error",
        description: "Failed to update calendar settings.",
        duration: 5000,
      })
    } finally {
      setSaving(false)
    }
  }

  const generateCalendarUrl = (format: 'ics' | 'webcal') => {
    const baseUrl = window.location.origin
    const params = new URLSearchParams()
    
    if (settings?.calendarSyncType === 'with_due_times') {
      params.set('filter', 'due_times_only')
    }
    
    const path = format === 'webcal' 
      ? `/api/calendar/tasks.ics?${params}`.replace('http://', 'webcal://').replace('https://', 'webcal://')
      : `/api/calendar/tasks.ics?${params}`
    
    return format === 'webcal' 
      ? `webcal://${window.location.host}/api/calendar/tasks.ics?${params}`
      : `${baseUrl}${path}`
  }

  const downloadCalendar = () => {
    const url = generateCalendarUrl('ics')
    const link = document.createElement('a')
    link.href = url
    link.download = 'astrid-tasks.ics'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const subscribeToCalendar = () => {
    const url = generateCalendarUrl('webcal')
    window.open(url, '_blank')
  }

  if (loading) {
    return (
      <Card className="theme-bg-secondary theme-border">
        <CardContent className="p-6">
          <div className="flex items-center space-x-2">
            <RefreshCw className="w-4 h-4 animate-spin theme-text-muted" />
            <span className="theme-text-muted">Loading calendar settings...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!settings) {
    return null
  }

  return (
    <Card className="theme-bg-secondary theme-border">
      <CardHeader>
        <CardTitle className="theme-text-primary flex items-center space-x-2">
          <Calendar className="w-5 h-5" />
          <span>Calendar Integration</span>
        </CardTitle>
        <CardDescription className="theme-text-muted">
          Sync your tasks with external calendar applications
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable Calendar Sync */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="theme-text-secondary">Enable Calendar Sync</Label>
            <p className="text-sm theme-text-muted">
              Allow your tasks to be exported to calendar applications
            </p>
          </div>
          <Switch
            checked={settings.enableCalendarSync}
            onCheckedChange={(checked) => updateSetting('enableCalendarSync', checked)}
            disabled={saving}
            className="data-[state=checked]:bg-blue-600"
          />
        </div>

        {settings.enableCalendarSync && (
          <>
            {/* Calendar Sync Type */}
            <div className="space-y-2">
              <Label className="theme-text-secondary">What to include in calendar</Label>
              <Select
                value={settings.calendarSyncType}
                onValueChange={(value) => updateSetting('calendarSyncType', value)}
                disabled={saving}
              >
                <SelectTrigger className="theme-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tasks</SelectItem>
                  <SelectItem value="with_due_times">Only tasks with due dates/times</SelectItem>
                  <SelectItem value="none">None (disabled)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs theme-text-muted">
                {settings.calendarSyncType === 'all' && 'All tasks will appear in your calendar, including those without due dates'}
                {settings.calendarSyncType === 'with_due_times' && 'Only tasks with due dates or "when" times will appear in your calendar'}
                {settings.calendarSyncType === 'none' && 'No tasks will be synced to your calendar'}
              </p>
            </div>

            {/* Calendar Actions */}
            {settings.calendarSyncType !== 'none' && (
              <div className="space-y-4 pt-4 border-t theme-border">
                <Label className="theme-text-secondary">Calendar Export</Label>
                
                {/* Download Options */}
                <div className="space-y-3">
                  <div className="flex flex-col space-y-2">
                    <Button
                      onClick={downloadCalendar}
                      variant="outline"
                      className="w-full justify-start bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Calendar File (.ics)
                    </Button>
                    <p className="text-xs theme-text-muted ml-6">
                      One-time download to import into your calendar app
                    </p>
                  </div>

                  <div className="flex flex-col space-y-2">
                    <Button
                      onClick={subscribeToCalendar}
                      variant="outline"
                      className="w-full justify-start bg-green-50 hover:bg-green-100 border-green-200 text-green-700 dark:bg-green-900/20 dark:hover:bg-green-900/30 dark:border-green-800 dark:text-green-300"
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Subscribe to Live Calendar
                    </Button>
                    <p className="text-xs theme-text-muted ml-6">
                      Live subscription that automatically updates as tasks change
                    </p>
                  </div>
                </div>

                {/* Instructions */}
                <div className="p-4 theme-bg-tertiary rounded-lg">
                  <h4 className="text-sm font-medium theme-text-secondary mb-2">How to use:</h4>
                  <ul className="text-xs theme-text-muted space-y-1">
                    <li>• <strong>Download:</strong> Import the .ics file once into Google Calendar, Apple Calendar, or Outlook</li>
                    <li>• <strong>Subscribe:</strong> Add the webcal URL to automatically sync changes (recommended)</li>
                    <li>• Your tasks will appear as all-day events or at their scheduled times</li>
                    <li>• Updates to tasks in {BRAND.appName} will be reflected in subscribed calendars</li>
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}