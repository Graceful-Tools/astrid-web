"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TimePicker } from "@/components/ui/time-picker"
import { Clock, CheckCircle, AlertCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export function UserDefaultDueTimeSettings() {
  const [defaultDueTime, setDefaultDueTime] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  // Load current default due time
  useEffect(() => {
    const loadDefaultDueTime = async () => {
      try {
        const response = await fetch("/api/v1/users/me/default-due-time")
        if (response.ok) {
          const data = await response.json()
          setDefaultDueTime(data.defaultDueTime || null)
        }
      } catch (error) {
        console.error("Error loading default due time:", error)
      } finally {
        setLoading(false)
      }
    }

    loadDefaultDueTime()
  }, [])

  const handleTimeChange = async (time: string | null) => {
    setSaving(true)
    try {
      const response = await fetch("/api/v1/users/me/default-due-time", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ defaultDueTime: time }),
      })

      if (response.ok) {
        setDefaultDueTime(time)
        toast({
          title: "Settings saved",
          description: time 
            ? `Default due time set to ${formatTime(time)}` 
            : "Default due time cleared",
        })
      } else {
        throw new Error("Failed to save settings")
      }
    } catch (error) {
      console.error("Error saving default due time:", error)
      toast({
        title: "Error",
        description: "Failed to save default due time settings",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const formatTime = (timeString: string): string => {
    const [hours, minutes] = timeString.split(':').map(Number)
    const period = hours >= 12 ? 'PM' : 'AM'
    const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    const minuteStr = minutes === 0 ? '' : `:${minutes.toString().padStart(2, '0')}`
    return `${hour12}${minuteStr}${period.toLowerCase()}`
  }

  if (loading) {
    return (
      <Card className="theme-bg-secondary theme-border">
        <CardHeader>
          <CardTitle className="theme-text-primary flex items-center space-x-2">
            <Clock className="w-5 h-5" />
            <span>Default Due Time</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse h-10 bg-gray-300 rounded"></div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="theme-bg-secondary theme-border">
      <CardHeader>
        <CardTitle className="theme-text-primary flex items-center space-x-2">
          <Clock className="w-5 h-5" />
          <span>Default Due Time</span>
        </CardTitle>
        <CardDescription className="theme-text-muted">
          Set the default time for new tasks when you select a due date
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <TimePicker
            mode="string"
            value={defaultDueTime}
            onChange={(time) => handleTimeChange(typeof time === "string" ? time : null)}
            placeholder="5pm (default)"
            showAllDayOption={true}
            label="Default due time"
            compact
          />
          {defaultDueTime && (
            <p className="text-sm theme-text-muted">
              New tasks with due dates will default to {formatTime(defaultDueTime)}
            </p>
          )}
          {!defaultDueTime && (
            <p className="text-sm theme-text-muted">
              New tasks with due dates will default to 5pm
            </p>
          )}
        </div>

        {saving && (
          <div className="flex items-center justify-center py-2">
            <div className="flex items-center space-x-2 theme-text-muted">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent"></div>
              <span className="text-sm">Saving...</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}