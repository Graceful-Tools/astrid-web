"use client"

import { useTranslations } from "@/lib/i18n/client"
import { ReminderSettingsComponent } from "@/components/reminder-settings"
import { CalendarIntegrationSettings } from "@/components/calendar-integration-settings"
import { UserDefaultDueTimeSettings } from "@/components/user-default-due-time-settings"
import { PushNotificationSettings } from "@/components/push-notification-settings"
import {
  Bell,
} from "lucide-react"

interface RemindersSettingsProps {
  onNavigate: (page: string) => void
}

export default function RemindersSettings({ onNavigate }: RemindersSettingsProps) {
  const { t } = useTranslations()

  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        {/* Settings Page Header */}
        <div className="flex items-center space-x-3">
          <Bell className="w-8 h-8 text-orange-500" />
          <div>
            <h1 className="text-2xl font-bold theme-text-primary">{t("settingsPages.remindersNotifications.title")}</h1>
            <p className="theme-text-muted">{t("settingsPages.remindersNotifications.description")}</p>
          </div>
        </div>

        {/* Reminder Settings */}
        <ReminderSettingsComponent />

        {/* Push Notification Settings */}
        <PushNotificationSettings />

        {/* Calendar Integration Settings */}
        <CalendarIntegrationSettings />

        {/* User Default Due Time Settings */}
        <UserDefaultDueTimeSettings />
      </div>
    </div>
  )
}
