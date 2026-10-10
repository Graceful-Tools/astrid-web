"use client"

import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n/client"

/** The desktop sidebar's open/close icon, as on Mac (AWTD-1163). */
export function SidebarToggleButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslations()
  const label = collapsed ? t("navigation.showSidebar") : t("navigation.hideSidebar")
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggle}
      className="theme-text-muted hover:theme-text-primary h-8 w-8 p-0 flex-shrink-0"
      aria-label={label}
      title={label}
      aria-expanded={!collapsed}
    >
      <Icon className="w-4 h-4" />
    </Button>
  )
}
