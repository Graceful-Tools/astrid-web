"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { useTranslations } from "@/lib/i18n/client"
import { useToast } from "@/hooks/use-toast"
import { signOut } from "next-auth/react"
import {
  User,
  Bell,
  Brain,
  Bug,
  Palette,
  ChevronRight,
  Network,
  Users,
  HelpCircle,
  RefreshCw,
  LogOut
} from "lucide-react"

interface SettingsHubProps {
  onNavigate: (page: string) => void
}

export default function SettingsHub({ onNavigate }: SettingsHubProps) {
  const { t } = useTranslations()
  const { toast } = useToast()
  const [refreshingData, setRefreshingData] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleRefreshData = async () => {
    setRefreshingData(true)
    try {
      await fetch("/api/cache/clear", { method: "POST", headers: { "Content-Type": "application/json" } })
      toast({ title: t("messages.success"), description: t("messages.dataRefreshed"), duration: 3000 })
      setTimeout(() => window.location.reload(), 1500)
    } catch {
      toast({ title: t("messages.cacheCleared"), description: t("messages.dataRefreshed"), duration: 3000 })
      setTimeout(() => window.location.reload(), 1500)
    } finally {
      setRefreshingData(false)
    }
  }

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true)
      await signOut({ callbackUrl: "/auth/signin" })
    } catch (error) {
      console.error("Error signing out:", error)
    } finally {
      setIsSigningOut(false)
    }
  }

  const settingsCategories = [
    {
      icon: User,
      title: t("settingsPages.accountAccess.title"),
      description: t("settingsPages.accountAccess.description"),
      page: "account",
      color: "text-blue-500"
    },
    {
      icon: Bell,
      title: t("settingsPages.remindersNotifications.title"),
      description: t("settingsPages.remindersNotifications.description"),
      page: "reminders",
      color: "text-orange-500"
    },
    {
      icon: Brain,
      title: t("settingsPages.aiAgents.title"),
      description: t("settingsPages.aiAgents.description"),
      page: "agents",
      color: "text-purple-500"
    },
    {
      icon: Network,
      title: t("settingsPages.apiAccess.title"),
      description: t("settingsPages.apiAccess.description"),
      page: "api-access",
      color: "text-blue-600"
    },
    {
      icon: Users,
      title: t("settingsPages.contacts.title"),
      description: t("settingsPages.contacts.description"),
      page: "contacts",
      color: "text-teal-500"
    },
    {
      icon: Palette,
      title: t("settingsPages.appearance.title"),
      description: t("settingsPages.appearance.description"),
      page: "appearance",
      color: "text-pink-500"
    },
    {
      icon: Bug,
      title: t("settingsPages.debug.title"),
      description: t("settingsPages.debug.description"),
      page: "debug",
      color: "text-green-500"
    },
    {
      icon: HelpCircle,
      title: "Help & Support",
      description: "Troubleshooting guides and contact support",
      page: "help",
      color: "text-cyan-500"
    },
    {
      icon: RefreshCw,
      title: t("userMenu.refreshData"),
      description: "Clear cache and reload fresh data",
      page: "_refresh",
      color: "text-emerald-500"
    },
    {
      icon: LogOut,
      title: t("userMenu.signOut"),
      description: "Sign out of your account",
      page: "_signout",
      color: "text-red-500"
    }
  ]

  return (
    <div className="p-2 sm:p-4">
      <div className="space-y-4 sm:space-y-6">
        {/* Settings Page Header */}
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <div className="w-4 h-4 bg-white rounded-sm"></div>
          </div>
          <div>
            <h1 className="text-2xl font-bold theme-text-primary">{t("settings.settings")}</h1>
            <p className="theme-text-muted">{t("settingsPages.manageAccount")}</p>
          </div>
        </div>

        {/* Settings Categories Grid */}
        <div className="grid gap-4">
          {settingsCategories.map((category) => {
            const IconComponent = category.icon
            return (
              <Card
                key={category.page}
                data-settings-page={category.page}
                className="theme-bg-secondary theme-border cursor-pointer hover:scale-[1.02] transition-transform"
                onClick={() => {
                  if (category.page === '_refresh') {
                    handleRefreshData()
                  } else if (category.page === '_signout') {
                    handleSignOut()
                  } else {
                    onNavigate(category.page)
                  }
                }}
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="p-2 theme-bg-tertiary rounded-lg">
                        <IconComponent className={`w-6 h-6 ${category.color}`} />
                      </div>
                      <div>
                        <h3 className="font-semibold theme-text-primary">{category.title}</h3>
                        <p className="text-sm theme-text-muted">{category.description}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 theme-text-muted" />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
