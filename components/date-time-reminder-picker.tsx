"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CalendarIcon, Clock, Bell, AlertCircle } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"
import { format } from "date-fns"
import type { ReminderSettings } from "@/types/reminder"

interface DateTimeReminderPickerProps {
  dueDateTime?: Date | null
  reminderTime?: Date | null
  reminderType?: "push" | "email" | "both" | null
  onDueDateTimeChange: (date: Date | null) => void
  onReminderTimeChange: (date: Date | null) => void
  onReminderTypeChange: (type: "push" | "email" | "both" | null) => void
  compact?: boolean
  userReminderSettings?: ReminderSettings
}

// Convert minutes to human readable format
const formatReminderOffset = (minutes: number): string => {
  if (minutes === 0) return "At due time"
  if (minutes < 60) return `${minutes} min before`
  if (minutes === 60) return "1 hour before" 
  if (minutes < 1440) return `${Math.round(minutes / 60)} hours before`
  return `${Math.round(minutes / 1440)} days before`
}

// Get preset reminder options
const getReminderOffsetOptions = () => [
  { value: 0, label: "At due time" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 360, label: "6 hours before" },
  { value: 720, label: "12 hours before" },
  { value: 1440, label: "1 day before" },
  { value: 2880, label: "2 days before" },
]

export function DateTimeReminderPicker({
  dueDateTime,
  reminderTime,
  reminderType,
  onDueDateTimeChange,
  onReminderTimeChange,
  onReminderTypeChange,
  compact = false,
  userReminderSettings
}: DateTimeReminderPickerProps) {
  const { t } = useTranslations()
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    dueDateTime ? new Date(dueDateTime) : undefined
  )
  const [selectedTime, setSelectedTime] = useState<string>("")
  const [enableReminder, setEnableReminder] = useState<boolean>(!!reminderTime)
  const [reminderOffset, setReminderOffset] = useState<number>(
    userReminderSettings?.defaultReminderTime || 60
  )
  const [customReminderType, setCustomReminderType] = useState<"push" | "email" | "both">(
    reminderType || "both"
  )

  // Initialize time from existing dueDateTime
  useEffect(() => {
    if (dueDateTime) {
      const timeString = format(dueDateTime, "HH:mm")
      setSelectedTime(timeString)
    }
  }, [dueDateTime])

  // Calculate and update reminder time when due date or offset changes
  useEffect(() => {
    if (selectedDate && enableReminder) {
      const combinedDateTime = new Date(selectedDate)
      
      // Set time if provided
      if (selectedTime) {
        const [hours, minutes] = selectedTime.split(':').map(Number)
        combinedDateTime.setHours(hours, minutes, 0, 0)
      }
      
      // Calculate reminder time
      const reminderDateTime = new Date(combinedDateTime)
      reminderDateTime.setMinutes(reminderDateTime.getMinutes() - reminderOffset)
      
      onReminderTimeChange(reminderDateTime)
      onReminderTypeChange(customReminderType)
    } else {
      onReminderTimeChange(null)
      onReminderTypeChange(null)
    }
  }, [selectedDate, selectedTime, enableReminder, reminderOffset, customReminderType, onReminderTimeChange, onReminderTypeChange])

  // Update due date time when date or time changes
  useEffect(() => {
    if (selectedDate) {
      const combinedDateTime = new Date(selectedDate)
      
      if (selectedTime) {
        const [hours, minutes] = selectedTime.split(':').map(Number)
        combinedDateTime.setHours(hours, minutes, 0, 0)
      } else {
        // Set to end of day if no time specified
        combinedDateTime.setHours(23, 59, 59, 999)
      }
      
      onDueDateTimeChange(combinedDateTime)
    } else {
      onDueDateTimeChange(null)
    }
  }, [selectedDate, selectedTime, onDueDateTimeChange])

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date)
  }

  const handleTimeChange = (timeValue: string) => {
    setSelectedTime(timeValue)
  }

  const getQuickDateOptions = () => [
    {
      label: "Today",
      onClick: () => setSelectedDate(new Date())
    },
    {
      label: "Tomorrow", 
      onClick: () => {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        setSelectedDate(tomorrow)
      }
    },
    {
      label: "Next Week",
      onClick: () => {
        const nextWeek = new Date()
        nextWeek.setDate(nextWeek.getDate() + 7)
        setSelectedDate(nextWeek)
      }
    },
  ]

  // Check if user has notification permissions and settings
  const hasNotificationSupport = typeof window !== 'undefined' && 'Notification' in window
  const canReceivePushNotifications = hasNotificationSupport && Notification.permission === 'granted' && 
    userReminderSettings?.enablePushReminders
  const canReceiveEmailNotifications = userReminderSettings?.enableEmailReminders

  const getReminderTypeOptions = () => {
    const options = []
    if (canReceivePushNotifications && canReceiveEmailNotifications) {
      options.push({ value: "both", label: "Push & Email" })
    }
    if (canReceivePushNotifications) {
      options.push({ value: "push", label: "Push Notification" })
    }
    if (canReceiveEmailNotifications) {
      options.push({ value: "email", label: "Email" })
    }
    return options
  }

  const reminderTypeOptions = getReminderTypeOptions()

  return (
    <div className="space-y-4">
      {/* Date Selection */}
      <div>
        <Label className={compact ? "text-gray-700" : "text-gray-300"}>Due Date</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={`w-full justify-start ${
                compact 
                  ? "bg-white border-gray-300 text-gray-900 hover:bg-gray-50" 
                  : "bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
              }`}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {selectedDate ? format(selectedDate, "PPP") : "Select date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <div className="p-3 border-b border-gray-200">
              <div className="grid grid-cols-3 gap-2">
                {getQuickDateOptions().map((option, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={option.onClick}
                    className="text-sm"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            <Calendar 
              mode="single" 
              selected={selectedDate} 
              onSelect={handleDateSelect} 
              initialFocus 
              disabled={(date) => date < new Date("1900-01-01")}
            />
            {selectedDate && (
              <div className="p-3 border-t border-gray-200">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedDate(undefined)}
                  className="w-full text-sm"
                >
                  {t('time.noDate')}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Time Selection */}
      {selectedDate && (
        <div>
          <Label className={compact ? "text-gray-700" : "text-gray-300"} htmlFor="due-time">
            <Clock className="inline w-4 h-4 mr-1" />
            Due Time (optional)
          </Label>
          <Input
            id="due-time"
            type="time"
            value={selectedTime}
            onChange={(e) => handleTimeChange(e.target.value)}
            className={
              compact 
                ? "bg-white border-gray-300 text-gray-900" 
                : "bg-gray-700 border-gray-600 text-white"
            }
          />
          <p className={`text-xs mt-1 ${compact ? "text-gray-500" : "text-gray-400"}`}>
            Leave empty to default to end of day
          </p>
        </div>
      )}

      {/* Reminder Settings */}
      {selectedDate && (
        <div className="space-y-3 pt-2 border-t border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <Label className={`${compact ? "text-gray-700" : "text-gray-300"} flex items-center space-x-2`}>
                <Bell className="w-4 h-4" />
                <span>Set Reminder</span>
              </Label>
              <p className={`text-xs ${compact ? "text-gray-500" : "text-gray-400"}`}>
                Get notified before this task is due
              </p>
            </div>
            <Switch
              checked={enableReminder}
              onCheckedChange={setEnableReminder}
            />
          </div>

          {enableReminder && (
            <div className="space-y-3 ml-6">
              {/* Reminder Timing */}
              <div>
                <Label className={`text-sm ${compact ? "text-gray-600" : "text-gray-400"}`}>
                  Remind me
                </Label>
                <Select
                  value={reminderOffset.toString()}
                  onValueChange={(value) => setReminderOffset(parseInt(value))}
                >
                  <SelectTrigger className={
                    compact 
                      ? "bg-white border-gray-300 text-gray-900" 
                      : "bg-gray-700 border-gray-600 text-white"
                  }>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getReminderOffsetOptions().map((option) => (
                      <SelectItem key={option.value} value={option.value.toString()}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Reminder Type */}
              {reminderTypeOptions.length > 0 && (
                <div>
                  <Label className={`text-sm ${compact ? "text-gray-600" : "text-gray-400"}`}>
                    Notification type
                  </Label>
                  <Select
                    value={customReminderType}
                    onValueChange={(value: "push" | "email" | "both") => setCustomReminderType(value)}
                  >
                    <SelectTrigger className={
                      compact 
                        ? "bg-white border-gray-300 text-gray-900" 
                        : "bg-gray-700 border-gray-600 text-white"
                    }>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {reminderTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Reminder Preview */}
              {selectedDate && selectedTime && (
                <div className={`text-xs p-2 rounded ${compact ? "bg-blue-50 text-blue-700" : "bg-blue-900/30 text-blue-300"}`}>
                  <div className="flex items-center space-x-1">
                    <Bell className="w-3 h-3" />
                    <span>
                      Reminder will be sent at {format(
                        new Date(selectedDate.getTime() + 
                          (selectedTime ? 
                            (parseInt(selectedTime.split(':')[0]) * 60 + parseInt(selectedTime.split(':')[1]) - reminderOffset) * 60000 :
                            (23 * 60 + 59 - reminderOffset) * 60000
                          )
                        ), 
                        "PPP 'at' h:mm a"
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* Warning if no notification methods available */}
              {reminderTypeOptions.length === 0 && (
                <div className={`text-xs p-2 rounded flex items-start space-x-2 ${
                  compact ? "bg-yellow-50 text-yellow-700" : "bg-yellow-900/30 text-yellow-300"
                }`}>
                  <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">No notification methods enabled</p>
                    <p>Enable push notifications or email reminders in Settings to receive task reminders.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}