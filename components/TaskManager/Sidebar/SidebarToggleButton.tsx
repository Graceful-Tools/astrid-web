"use client"

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n/client"

interface PaneToggleButtonProps {
  collapsed: boolean
  onToggle: () => void
}

function PaneToggleButton({ collapsed, onToggle, label, Icon }: PaneToggleButtonProps & { label: string; Icon: typeof PanelLeftOpen }) {
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

/** The desktop sidebar's open/close icon, as on Mac (AWTD-1163). */
export function SidebarToggleButton({ collapsed, onToggle }: PaneToggleButtonProps) {
  const { t } = useTranslations()
  return (
    <PaneToggleButton
      collapsed={collapsed}
      onToggle={onToggle}
      label={collapsed ? t("navigation.showSidebar") : t("navigation.hideSidebar")}
      Icon={collapsed ? PanelLeftOpen : PanelLeftClose}
    />
  )
}

/** Its mirror image on the right, for the messages pane (AWTD-1178). */
export function ChatPaneToggleButton({ collapsed, onToggle }: PaneToggleButtonProps) {
  const { t } = useTranslations()
  return (
    <PaneToggleButton
      collapsed={collapsed}
      onToggle={onToggle}
      label={collapsed ? t("navigation.showMessages") : t("navigation.hideMessages")}
      Icon={collapsed ? PanelRightOpen : PanelRightClose}
    />
  )
}
