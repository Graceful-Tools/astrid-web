"use client"

import { BRAND } from '@/lib/brand/config'
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTheme } from "@/contexts/theme-context"
import { KeyboardShortcutsMenu } from "@/components/keyboard-shortcuts-menu"
import { useTranslations } from "@/lib/i18n/client"
import { RichMessage } from "@/components/shared/RichMessage"
import { useUserSettings } from "@/hooks/useUserSettings"
import {
  Palette,
  Sun,
  Moon,
  Waves,
  Keyboard,
  Mail,
  Sparkles,
  ListTree,
  LayoutList,
  WrapText,
  Bell
} from "lucide-react"
import { ROW_TITLE_LINES, parseRowTitleLines } from "@/lib/design/row-title"

interface AppearanceSettingsProps {
  onNavigate: (page: string) => void
}

export default function AppearanceSettings({ onNavigate }: AppearanceSettingsProps) {
  const {
    theme,
    setTheme,
    rowTitleLines: storedRowTitleLines,
    setRowTitleLines,
    showTaskReminders,
    setShowTaskReminders,
  } = useTheme()
  const rowTitleLines = parseRowTitleLines(storedRowTitleLines)
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  /**
   * Read and write these through the SHARED hook, not a private copy
   * (task 9523d634).
   *
   * This component used to fetch /api/v1/users/me/smart-tasks itself and keep
   * its own useState for the same three fields that useUserSettings already
   * holds — a third copy alongside TasksSettings. Changing a setting here left
   * the live TaskManager showing the old value until a reload, because nothing
   * told it. The hook also rolls a rejected write back and says so, which the
   * private savers here did not: they logged to the console and left the
   * control flipped.
   */
  const {
    updateSettings,
    smartTaskCreationEnabled,
    subtaskDisplay,
    taskDisplayMode,
  } = useUserSettings()
  const { t } = useTranslations()

  // The message arrives with the address already in it (lib/brand/i18n-values.ts
  // substitutes brand tokens at load), so mark where it sits to style it.
  const emailLine = (key: string) => (
    <RichMessage
      message={t(key).replace(BRAND.inboundTaskEmail, "{email}")}
      values={{
        email: <code className="px-1.5 py-0.5 bg-theme-active rounded text-xs font-mono">{BRAND.inboundTaskEmail}</code>,
      }}
    />
  )

  const handleSubtaskDisplayChange = (value: string) => updateSettings({ subtaskDisplay: value })
  const handleTaskDisplayModeChange = (value: string) => updateSettings({ taskDisplayMode: value })
  const handleSmartTaskCreationChange = (enabled: boolean) =>
    updateSettings({ smartTaskCreationEnabled: enabled })

  return (
    <>
      <div className="p-2 sm:p-4">
        <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
          {/* Settings Page Header */}
          <div className="flex items-center space-x-3">
            <Palette className="w-8 h-8 text-pink-500" />
            <div>
              <h1 className="text-2xl font-bold theme-text-primary">{t("settingsPages.appearancePage.title")}</h1>
              <p className="theme-text-muted">{t("settingsPages.appearancePage.description")}</p>
            </div>
          </div>

          {/* Theme Settings */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Palette className="w-5 h-5" />
                <span>{t("settingsPages.appearancePage.theme.title")}</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                {t("settingsPages.appearancePage.theme.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Theme Options */}
              <div className="space-y-3">
                {/* Ocean Theme */}
                <div
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    theme === 'ocean'
                      ? 'border-brand bg-theme-selected'
                      : 'border-theme hover:border-theme-strong'
                  }`}
                  onClick={() => setTheme('ocean')}
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                      <Waves className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-base font-medium theme-text-primary cursor-pointer">
                        {t("settingsPages.appearancePage.theme.ocean")}
                      </Label>
                      <p className="text-sm theme-text-muted">
                        {t("settingsPages.appearancePage.theme.oceanDesc")}
                      </p>
                    </div>
                    {theme === 'ocean' && (
                      <div className="w-4 h-4 bg-brand rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Light Mode */}
                <div
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    theme === 'light'
                      ? 'border-brand bg-theme-selected'
                      : 'border-theme hover:border-theme-strong'
                  }`}
                  onClick={() => setTheme('light')}
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                      <Sun className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-base font-medium theme-text-primary cursor-pointer">
                        {t("settingsPages.appearancePage.theme.light")}
                      </Label>
                      <p className="text-sm theme-text-muted">
                        {t("settingsPages.appearancePage.theme.lightDesc")}
                      </p>
                    </div>
                    {theme === 'light' && (
                      <div className="w-4 h-4 bg-brand rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dark Mode */}
                <div
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    theme === 'dark'
                      ? 'border-brand bg-theme-selected'
                      : 'border-theme hover:border-theme-strong'
                  }`}
                  onClick={() => setTheme('dark')}
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                      <Moon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-base font-medium theme-text-primary cursor-pointer">
                        {t("settingsPages.appearancePage.theme.dark")}
                      </Label>
                      <p className="text-sm theme-text-muted">
                        {t("settingsPages.appearancePage.theme.darkDesc")}
                      </p>
                    </div>
                    {theme === 'dark' && (
                      <div className="w-4 h-4 bg-brand rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-sm theme-text-muted mt-4 p-3 bg-brand-subtle rounded-lg">
                <p className="font-medium text-theme-primary mb-1">💡 {t("settingsPages.appearancePage.tipLabel")}</p>
                <p className="text-theme-primary">
                  {t("settingsPages.appearancePage.theme.proTip")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Keyboard Shortcuts */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Keyboard className="w-5 h-5" />
                <span>{t("settingsPages.appearancePage.keyboard.title")}</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                {t("settingsPages.appearancePage.keyboard.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-theme-secondary rounded-lg">
                <div className="flex-1">
                  <h3 className="font-medium theme-text-primary mb-1">{t("settingsPages.appearancePage.keyboard.viewTitle")}</h3>
                  <p className="text-sm theme-text-muted">
                    {t("settingsPages.appearancePage.keyboard.viewDesc")}
                  </p>
                </div>
                <Button
                  onClick={() => setShowKeyboardShortcuts(true)}
                  variant="outline"
                  className="ml-4"
                >
                  <Keyboard className="w-4 h-4 mr-2" />
                  {t("settingsPages.appearancePage.keyboard.viewShortcuts")}
                </Button>
              </div>

              <div className="text-sm theme-text-muted p-3 bg-brand-subtle rounded-lg">
                <p className="font-medium text-theme-primary mb-1">💡 {t("settingsPages.appearancePage.keyboard.quickAccessLabel")}</p>
                <p className="text-theme-primary">
                  {t("settingsPages.appearancePage.keyboard.quickAccess")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Smart Task Creation */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-yellow-500" />
                <span>{t("settingsPages.appearancePage.smartTasks.title")}</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                {t("settingsPages.appearancePage.smartTasks.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Toggle */}
              <div className="flex items-center justify-between p-4 bg-theme-secondary rounded-lg">
                <div className="flex-1">
                  <Label className="font-medium theme-text-primary">{t("settingsPages.appearancePage.smartTasks.enable")}</Label>
                  <p className="text-sm theme-text-muted">
                    {t("settingsPages.appearancePage.smartTasks.enableDesc")}
                  </p>
                </div>
                <Switch
                  checked={smartTaskCreationEnabled}
                  onCheckedChange={handleSmartTaskCreationChange}
                />
              </div>

              {/* Examples */}
              <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-lg border theme-border">
                <h4 className="font-medium theme-text-primary mb-2">{t("settingsPages.appearancePage.smartTasks.supportedPatterns")}</h4>
                <ul className="space-y-2 text-sm theme-text-muted">
                  <li className="flex items-start space-x-2">
                    <span className="text-yellow-500 mt-0.5">•</span>
                    <span><strong>{t("settingsPages.appearancePage.smartTasks.datesLabel")}</strong> &quot;Buy milk tomorrow&quot;, &quot;Meeting next week&quot;, &quot;Call mom monday&quot;</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="text-yellow-500 mt-0.5">•</span>
                    <span><strong>{t("settingsPages.appearancePage.smartTasks.priorityLabel")}</strong> &quot;Urgent fix bug&quot;, &quot;High priority review&quot;, &quot;Low priority cleanup&quot;</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="text-yellow-500 mt-0.5">•</span>
                    <span><strong>{t("settingsPages.appearancePage.smartTasks.listsLabel")}</strong> &quot;#shopping Buy groceries&quot;, &quot;#work Finish report&quot;</span>
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Task detail layout */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <LayoutList className="w-5 h-5 text-green-500" />
                <span>{t("settingsPages.appearancePage.taskDisplayMode.title")}</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                {t("settingsPages.appearancePage.taskDisplayMode.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 bg-theme-secondary rounded-lg">
                <div className="flex-1">
                  <Label className="font-medium theme-text-primary">
                    {t("settingsPages.appearancePage.taskDisplayMode.label")}
                  </Label>
                  <p className="text-sm theme-text-muted">
                    {t(`settingsPages.appearancePage.taskDisplayMode.${taskDisplayMode}Desc`)}
                  </p>
                </div>
                <Select value={taskDisplayMode} onValueChange={handleTaskDisplayModeChange}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="list">
                      {t("settingsPages.appearancePage.taskDisplayMode.list")}
                    </SelectItem>
                    <SelectItem value="project">
                      {t("settingsPages.appearancePage.taskDisplayMode.project")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Task titles: how many lines a row's title may take */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <WrapText className="w-5 h-5 theme-text-secondary" />
                <span>{t("settingsPages.appearancePage.taskTitles.title")}</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                {t("settingsPages.appearancePage.taskTitles.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 theme-bg-tertiary rounded-lg">
                <div className="flex-1">
                  <Label id="row-title-lines-label" className="font-medium theme-text-primary">
                    {t("settingsPages.appearancePage.taskTitles.label")}
                  </Label>
                  <p className="text-sm theme-text-muted">
                    {t(`settingsPages.appearancePage.taskTitles.desc${rowTitleLines}`)}
                  </p>
                </div>
                <Select value={rowTitleLines} onValueChange={(value) => setRowTitleLines(parseRowTitleLines(value))}>
                  <SelectTrigger className="w-56" data-testid="row-title-lines" aria-labelledby="row-title-lines-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROW_TITLE_LINES.map((lines) => (
                      <SelectItem key={lines} value={lines}>
                        {t(`settingsPages.appearancePage.taskTitles.option${lines}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Task reminders: the Reminder row in task details is opt-in (AWTD-1577) */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Bell className="w-5 h-5 theme-text-secondary" />
                <span>{t("settingsPages.appearancePage.taskReminders.title")}</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                {t("settingsPages.appearancePage.taskReminders.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 theme-bg-tertiary rounded-lg">
                <div className="flex-1">
                  <Label id="show-task-reminders-label" className="font-medium theme-text-primary">
                    {t("settingsPages.appearancePage.taskReminders.label")}
                  </Label>
                  <p className="text-sm theme-text-muted">
                    {t("settingsPages.appearancePage.taskReminders.labelDesc")}
                  </p>
                </div>
                <Switch
                  data-testid="show-task-reminders"
                  aria-labelledby="show-task-reminders-label"
                  checked={showTaskReminders === true}
                  onCheckedChange={setShowTaskReminders}
                />
              </div>
            </CardContent>
          </Card>

          {/* Sub tasks display */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <ListTree className="w-5 h-5 text-brand" />
                <span>{t("settingsPages.appearancePage.subtasks.title")}</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                {t("settingsPages.appearancePage.subtasks.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 bg-theme-secondary rounded-lg">
                <div className="flex-1">
                  <Label className="font-medium theme-text-primary">{t("settingsPages.appearancePage.subtasks.label")}</Label>
                  <p className="text-sm theme-text-muted">
                    {t("settingsPages.appearancePage.subtasks.labelDesc")}
                  </p>
                </div>
                <Select value={subtaskDisplay} onValueChange={handleSubtaskDisplayChange}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="indented">{t("settingsPages.appearancePage.subtasks.indented")}</SelectItem>
                    <SelectItem value="under_parent">{t("settingsPages.appearancePage.subtasks.underParent")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Email-to-Task Feature */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Mail className="w-5 h-5" />
                <span>{t("settingsPages.appearancePage.emailToTask.title")}</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                {t("settingsPages.appearancePage.emailToTask.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-lg border theme-border">
                <div className="flex items-start space-x-3">
                  <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                    <Mail className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium theme-text-primary mb-2">{t("settingsPages.appearancePage.emailToTask.threeWays")}</h3>
                    <ul className="space-y-2 text-sm theme-text-muted">
                      <li className="flex items-start space-x-2">
                        <span className="text-purple-500 mt-0.5">•</span>
                        <span><strong>{t("settingsPages.appearancePage.emailToTask.selfTask")}</strong> {emailLine("settingsPages.appearancePage.emailToTask.selfTaskDesc")}</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-purple-500 mt-0.5">•</span>
                        <span><strong>{t("settingsPages.appearancePage.emailToTask.assignedTask")}</strong> {emailLine("settingsPages.appearancePage.emailToTask.assignedTaskDesc")}</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-purple-500 mt-0.5">•</span>
                        <span><strong>{t("settingsPages.appearancePage.emailToTask.groupTask")}</strong> {emailLine("settingsPages.appearancePage.emailToTask.groupTaskDesc")}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-theme-secondary rounded-lg">
                <div className="flex-1">
                  <h3 className="font-medium theme-text-primary mb-1">{t("settingsPages.appearancePage.emailToTask.configure")}</h3>
                  <p className="text-sm theme-text-muted">
                    {t("settingsPages.appearancePage.emailToTask.configureDesc")}
                  </p>
                </div>
                <Button
                  onClick={() => onNavigate('tasks')}
                  variant="outline"
                  className="ml-4"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  {t("settings.settings")}
                </Button>
              </div>

              <div className="text-sm theme-text-muted p-3 bg-brand-subtle rounded-lg">
                <p className="font-medium text-theme-primary mb-1">💡 {t("settingsPages.appearancePage.tipLabel")}</p>
                <p className="text-theme-primary">
                  {t("settingsPages.appearancePage.emailToTask.proTip")}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsMenu
        isOpen={showKeyboardShortcuts}
        onClose={() => setShowKeyboardShortcuts(false)}
      />
    </>
  )
}
