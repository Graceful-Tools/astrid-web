"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckSquare, Mail, Clock, AlertCircle } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"
import { RichMessage } from "@/components/shared/RichMessage"

interface TasksSettingsProps {
  onNavigate: (page: string) => void
}

export default function TasksSettings({ onNavigate }: TasksSettingsProps) {
  const { t } = useTranslations()
  const { data: session } = useSession()
  const [isSaving, setIsSaving] = useState(false)
  // The outcome, not its sentence: the alert's colour must not depend on the wording.
  const [saveResult, setSaveResult] = useState<"saved" | "failed" | null>(null)

  const [emailToTaskEnabled, setEmailToTaskEnabled] = useState(true)
  const [defaultTaskDueOffset, setDefaultTaskDueOffset] = useState("1_week")
  const [defaultDueTime, setDefaultDueTime] = useState("17:00")

  useEffect(() => {
    if (session?.user) {
      loadSettings()
    }
  }, [session])

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/v1/users/me/smart-tasks')
      if (response.ok) {
        const data = await response.json()
        setEmailToTaskEnabled(data.emailToTaskEnabled ?? true)
        setDefaultTaskDueOffset(data.defaultTaskDueOffset || "1_week")
        setDefaultDueTime(data.defaultDueTime || "17:00")
      }
    } catch (error) {
      console.error('Error loading settings:', error)
    }
  }

  const saveSettings = async () => {
    setIsSaving(true)
    setSaveResult(null)
    try {
      const response = await fetch('/api/v1/users/me/smart-tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailToTaskEnabled, defaultTaskDueOffset, defaultDueTime })
      })
      if (response.ok) {
        setSaveResult('saved')
        setTimeout(() => setSaveResult(null), 3000)
      } else {
        setSaveResult('failed')
      }
    } catch (error) {
      console.error('Error saving settings:', error)
      setSaveResult('failed')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex items-center space-x-3">
          <CheckSquare className="w-8 h-8 text-brand" />
          <div>
            <h1 className="text-2xl font-bold theme-text-primary">{t("settingsPages.tasksPage.title")}</h1>
            <p className="theme-text-muted">{t("settingsPages.tasksPage.description")}</p>
          </div>
        </div>

        {saveResult && (
          <Alert className={saveResult === 'saved' ? 'bg-success-subtle border-success' : 'bg-danger-subtle border-danger'}>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{t(saveResult === 'saved' ? "settingsPages.tasksPage.saved" : "settingsPages.tasksPage.saveFailed")}</AlertDescription>
          </Alert>
        )}

        <Card className="theme-bg-card theme-border">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Mail className="w-5 h-5 text-category-purple" />
              <CardTitle className="theme-text-primary">{t("settingsPages.appearancePage.emailToTask.title")}</CardTitle>
            </div>
            <CardDescription className="theme-text-muted">
              {t("settingsPages.tasksPage.emailDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="theme-text-primary">{t("settingsPages.tasksPage.enable")}</Label>
                <p className="text-sm theme-text-muted">{t("settingsPages.tasksPage.enableDesc")}</p>
              </div>
              <Switch checked={emailToTaskEnabled} onCheckedChange={setEmailToTaskEnabled} />
            </div>

            <div className="space-y-2">
              <Label className="theme-text-primary">{t("settingsPages.tasksPage.defaultDueDate")}</Label>
              <Select value={defaultTaskDueOffset} onValueChange={setDefaultTaskDueOffset}>
                <SelectTrigger className="theme-bg-secondary theme-border theme-text-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="theme-bg-card theme-border">
                  <SelectItem value="none" className="theme-text-primary hover:theme-bg-hover">{t("tasks.noDueDate")}</SelectItem>
                  <SelectItem value="1_day" className="theme-text-primary hover:theme-bg-hover">{t("settingsPages.tasksPage.offset1Day")}</SelectItem>
                  <SelectItem value="3_days" className="theme-text-primary hover:theme-bg-hover">{t("settingsPages.tasksPage.offset3Days")}</SelectItem>
                  <SelectItem value="1_week" className="theme-text-primary hover:theme-bg-hover">{t("settingsPages.tasksPage.offset1Week")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm theme-text-muted">{t("settingsPages.tasksPage.dueDateHint")}</p>
            </div>

            <div className="space-y-2">
              <Label className="theme-text-primary flex items-center space-x-2">
                <Clock className="w-4 h-4" />
                <span>{t("settingsPages.tasksPage.defaultDueTime")}</span>
              </Label>
              <Select value={defaultDueTime} onValueChange={setDefaultDueTime}>
                <SelectTrigger className="theme-bg-secondary theme-border theme-text-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="theme-bg-card theme-border">
                  <SelectItem value="09:00" className="theme-text-primary hover:theme-bg-hover">{t("settingsPages.tasksPage.time0900")}</SelectItem>
                  <SelectItem value="12:00" className="theme-text-primary hover:theme-bg-hover">{t("settingsPages.tasksPage.time1200")}</SelectItem>
                  <SelectItem value="17:00" className="theme-text-primary hover:theme-bg-hover">{t("settingsPages.tasksPage.time1700")}</SelectItem>
                  <SelectItem value="20:00" className="theme-text-primary hover:theme-bg-hover">{t("settingsPages.tasksPage.time2000")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm theme-text-muted">{t("settingsPages.tasksPage.dueTimeHint")}</p>
            </div>

            <div className="p-4 theme-bg-secondary rounded-lg border theme-border">
              <h4 className="font-medium theme-text-primary mb-2">{t("settingsPages.tasksPage.howTo")}</h4>
              <ul className="space-y-2 text-sm theme-text-muted">
                <li className="flex items-start space-x-2">
                  <span className="text-brand mt-0.5">•</span>
                  <span><strong>{t("settingsPages.appearancePage.emailToTask.selfTask")}</strong> {t("settingsPages.appearancePage.emailToTask.selfTaskDesc")}</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-brand mt-0.5">•</span>
                  <span><strong>{t("settingsPages.appearancePage.emailToTask.assignedTask")}</strong> {t("settingsPages.tasksPage.assignedTaskDesc")}</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-brand mt-0.5">•</span>
                  <span><strong>{t("settingsPages.appearancePage.emailToTask.groupTask")}</strong> {t("settingsPages.appearancePage.emailToTask.groupTaskDesc")}</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-category-purple mt-0.5">•</span>
                  <span><RichMessage message={t("settingsPages.tasksPage.subjectLine")} values={{ subject: <strong>{t("settingsPages.tasksPage.subject")}</strong> }} /></span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-category-purple mt-0.5">•</span>
                  <span><RichMessage message={t("settingsPages.tasksPage.bodyLine")} values={{ body: <strong>{t("settingsPages.tasksPage.body")}</strong> }} /></span>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={saveSettings} disabled={isSaving} className="bg-brand hover:bg-brand-hover text-brand-foreground">
            {isSaving ? t("settingsPages.profileInfo.saving") : t("settingsPages.tasksPage.saveSettings")}
          </Button>
        </div>
      </div>
    </div>
  )
}
