"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { useSettings } from "@/contexts/settings-context"
import { Switch } from "@/components/ui/switch"
import { useTranslations } from "@/lib/i18n/client"
import {
  Bug,
  RefreshCw,
} from "lucide-react"

interface DebugSettingsProps {
  onNavigate: (page: string) => void
}

export default function DebugSettings({ onNavigate }: DebugSettingsProps) {
  const { toast } = useToast()
  const { t } = useTranslations()

  // Add error handling for settings context
  let toastDebugMode = false
  let setToastDebugMode = (_enabled: boolean) => {}
  let reminderDebugMode = false
  let setReminderDebugMode = (_enabled: boolean) => {}

  try {
    const settings = useSettings()
    toastDebugMode = settings.toastDebugMode
    setToastDebugMode = settings.setToastDebugMode
    reminderDebugMode = settings.reminderDebugMode
    setReminderDebugMode = settings.setReminderDebugMode
  } catch (error) {
    console.error("Settings context error:", error)
  }

  const [restoringDefaults, setRestoringDefaults] = useState(false)
  const [refreshingData, setRefreshingData] = useState(false)

  const handleRestoreDefaultLists = async () => {
    setRestoringDefaults(true)
    try {
      const response = await fetch("/api/lists/restore-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      if (response.ok) {
        const result = await response.json()

        // Clear cache to refresh the data so user sees the changes
        try {
          await fetch("/api/cache/clear", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          })
        } catch (cacheError) {
          console.error("Failed to clear cache after restore:", cacheError)
        }

        toast({
          title: t("settingsPages.debug.toast.restoreSuccess.title"),
          description: t("settingsPages.debug.toast.restoreSuccess.description", { count: result.count }),
          duration: 3000,
        })
      } else {
        const error = await response.json()
        toast({
          title: t("settingsPages.debug.toast.restoreError.title"),
          description: error.error || t("settingsPages.debug.toast.restoreError.description"),
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error restoring default lists:", error)
      toast({
        title: t("settingsPages.debug.toast.restoreError.title"),
        description: t("settingsPages.debug.toast.restoreError.description"),
        duration: 5000,
      })
    } finally {
      setRestoringDefaults(false)
    }
  }

  const handleRefreshData = async () => {
    setRefreshingData(true)
    try {
      // Clear Redis cache
      const response = await fetch("/api/cache/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      if (response.ok) {
        toast({
          title: t("settingsPages.debug.toast.refreshSuccess.title"),
          description: t("settingsPages.debug.toast.refreshSuccess.description"),
          duration: 3000,
        })
        // Reload the page to get fresh data
        setTimeout(() => {
          window.location.reload()
        }, 1500)
      } else {
        toast({
          title: t("settingsPages.debug.toast.cacheCleared.title"),
          description: t("settingsPages.debug.toast.cacheCleared.description"),
          duration: 3000,
        })
        // Even if API fails, reload to get fresh data
        setTimeout(() => {
          window.location.reload()
        }, 1500)
      }
    } catch (error) {
      console.error("Error refreshing data:", error)
      toast({
        title: t("settingsPages.debug.toast.cacheCleared.title"),
        description: t("settingsPages.debug.toast.cacheCleared.description"),
        duration: 3000,
      })
      // Even if there's an error, reload to get fresh data
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    } finally {
      setRefreshingData(false)
    }
  }

  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        {/* Settings Page Header */}
        <div className="flex items-center space-x-3">
          <Bug className="w-8 h-8 text-green-500" />
          <div>
            <h1 className="text-2xl font-bold theme-text-primary">{t("settingsPages.debug.title")}</h1>
            <p className="theme-text-muted">{t("settingsPages.debug.description")}</p>
          </div>
        </div>

        {/* Debug Settings */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary flex items-center space-x-2">
              <Bug className="w-5 h-5" />
              <span>{t("settingsPages.debug.sections.debugOptions.title")}</span>
            </CardTitle>
            <CardDescription className="theme-text-muted">
              {t("settingsPages.debug.sections.debugOptions.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="theme-text-secondary">{t("settingsPages.debug.sections.debugOptions.toastDebugMode.label")}</Label>
                <p className="text-sm theme-text-muted">
                  {t("settingsPages.debug.sections.debugOptions.toastDebugMode.description")}
                </p>
                <p className="text-xs theme-text-muted">
                  {t("settingsPages.debug.sections.debugOptions.toastDebugMode.current")}: {toastDebugMode ? t("settingsPages.debug.sections.debugOptions.toastDebugMode.debugOn") : t("settingsPages.debug.sections.debugOptions.toastDebugMode.subtleOn")}
                </p>
              </div>
              <Switch
                checked={toastDebugMode}
                onCheckedChange={setToastDebugMode}
                className="data-[state=checked]:bg-blue-600"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="theme-text-secondary">{t("settingsPages.debug.sections.debugOptions.reminderDebugMode.label")}</Label>
                <p className="text-sm theme-text-muted">
                  {t("settingsPages.debug.sections.debugOptions.reminderDebugMode.description")}
                </p>
                <p className="text-xs theme-text-muted">
                  {t("settingsPages.debug.sections.debugOptions.reminderDebugMode.current")}: {reminderDebugMode ? t("settingsPages.debug.sections.debugOptions.reminderDebugMode.debugOn") : t("settingsPages.debug.sections.debugOptions.reminderDebugMode.debugOff")}
                </p>
              </div>
              <Switch
                checked={reminderDebugMode}
                onCheckedChange={setReminderDebugMode}
                className="data-[state=checked]:bg-orange-600"
              />
            </div>
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary">{t("settingsPages.debug.sections.dataManagement.title")}</CardTitle>
            <CardDescription className="theme-text-muted">
              {t("settingsPages.debug.sections.dataManagement.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label className="theme-text-secondary">{t("settingsPages.debug.sections.dataManagement.favoriteLists.label")}</Label>
              <p className="text-sm theme-text-muted">
                {t("settingsPages.debug.sections.dataManagement.favoriteLists.description")}
              </p>
              <Button
                onClick={handleRestoreDefaultLists}
                disabled={restoringDefaults}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {restoringDefaults ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    {t("settingsPages.debug.sections.dataManagement.favoriteLists.restoring")}
                  </>
                ) : (
                  t("settingsPages.debug.sections.dataManagement.favoriteLists.button")
                )}
              </Button>
            </div>

            <div className="pt-4 border-t">
              <div className="space-y-2">
                <Label className="theme-text-secondary">{t("settingsPages.debug.sections.dataManagement.refreshData.label")}</Label>
                <p className="text-sm theme-text-muted">
                  {t("settingsPages.debug.sections.dataManagement.refreshData.description")}
                </p>
                <Button
                  onClick={handleRefreshData}
                  disabled={refreshingData}
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                >
                  {refreshingData ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      {t("settingsPages.debug.sections.dataManagement.refreshData.refreshing")}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      {t("settingsPages.debug.sections.dataManagement.refreshData.button")}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
