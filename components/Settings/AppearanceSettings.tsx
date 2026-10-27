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
  LayoutList
} from "lucide-react"

interface AppearanceSettingsProps {
  onNavigate: (page: string) => void
}

export default function AppearanceSettings({ onNavigate }: AppearanceSettingsProps) {
  const { theme, setTheme } = useTheme()
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
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ocean:bg-blue-50'
                      : 'border-gray-300 dark:border-gray-600 ocean:border-blue-300 hover:border-gray-400 dark:hover:border-gray-500 ocean:hover:border-blue-400'
                  }`}
                  onClick={() => setTheme('ocean')}
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 ocean:bg-blue-100 rounded-lg">
                      <Waves className="w-5 h-5 text-blue-600 dark:text-blue-400 ocean:text-blue-600" />
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
                      <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Light Mode */}
                <div
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    theme === 'light'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ocean:bg-blue-50'
                      : 'border-gray-300 dark:border-gray-600 ocean:border-blue-300 hover:border-gray-400 dark:hover:border-gray-500 ocean:hover:border-blue-400'
                  }`}
                  onClick={() => setTheme('light')}
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 ocean:bg-yellow-100 rounded-lg">
                      <Sun className="w-5 h-5 text-yellow-600 dark:text-yellow-400 ocean:text-yellow-600" />
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
                      <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dark Mode */}
                <div
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    theme === 'dark'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ocean:bg-blue-50'
                      : 'border-gray-300 dark:border-gray-600 ocean:border-blue-300 hover:border-gray-400 dark:hover:border-gray-500 ocean:hover:border-blue-400'
                  }`}
                  onClick={() => setTheme('dark')}
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900/30 ocean:bg-purple-100 rounded-lg">
                      <Moon className="w-5 h-5 text-purple-600 dark:text-purple-400 ocean:text-purple-600" />
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
                      <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-sm theme-text-muted mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">💡 Pro Tip</p>
                <p className="text-blue-600 dark:text-blue-400">
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
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
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

              <div className="text-sm theme-text-muted p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">💡 Quick Access</p>
                <p className="text-blue-600 dark:text-blue-400">
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
                <span>Smart Task Creation</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Automatically parse dates, priorities, and list hashtags from task titles
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Toggle */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="flex-1">
                  <Label className="font-medium theme-text-primary">Enable Smart Parsing</Label>
                  <p className="text-sm theme-text-muted">
                    Extract task metadata from natural language input
                  </p>
                </div>
                <Switch
                  checked={smartTaskCreationEnabled}
                  onCheckedChange={handleSmartTaskCreationChange}
                />
              </div>

              {/* Examples */}
              <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-lg border theme-border">
                <h4 className="font-medium theme-text-primary mb-2">Supported patterns:</h4>
                <ul className="space-y-2 text-sm theme-text-muted">
                  <li className="flex items-start space-x-2">
                    <span className="text-yellow-500 mt-0.5">•</span>
                    <span><strong>Dates:</strong> &quot;Buy milk tomorrow&quot;, &quot;Meeting next week&quot;, &quot;Call mom monday&quot;</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="text-yellow-500 mt-0.5">•</span>
                    <span><strong>Priority:</strong> &quot;Urgent fix bug&quot;, &quot;High priority review&quot;, &quot;Low priority cleanup&quot;</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="text-yellow-500 mt-0.5">•</span>
                    <span><strong>Lists:</strong> &quot;#shopping Buy groceries&quot;, &quot;#work Finish report&quot;</span>
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
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
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

          {/* Sub tasks display */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <ListTree className="w-5 h-5 text-blue-500" />
                <span>Sub tasks</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                How sub tasks appear in your lists (synced across devices)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="flex-1">
                  <Label className="font-medium theme-text-primary">Show sub tasks</Label>
                  <p className="text-sm theme-text-muted">
                    Indented in lists, or only inside the parent task
                  </p>
                </div>
                <Select value={subtaskDisplay} onValueChange={handleSubtaskDisplayChange}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="indented">In lists, indented</SelectItem>
                    <SelectItem value="under_parent">Inside parent task only</SelectItem>
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
                        <span><strong>{t("settingsPages.appearancePage.emailToTask.selfTask")}</strong> Send TO <code className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">{BRAND.inboundTaskEmail}</code></span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-purple-500 mt-0.5">•</span>
                        <span><strong>{t("settingsPages.appearancePage.emailToTask.assignedTask")}</strong> CC <code className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">{BRAND.inboundTaskEmail}</code> with one recipient</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-purple-500 mt-0.5">•</span>
                        <span><strong>{t("settingsPages.appearancePage.emailToTask.groupTask")}</strong> CC <code className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">{BRAND.inboundTaskEmail}</code> with multiple recipients</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
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

              <div className="text-sm theme-text-muted p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">💡 Pro Tip</p>
                <p className="text-blue-600 dark:text-blue-400">
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
