"use client"

import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { LayoutGrid, FlaskConical } from "lucide-react"
import { useProjectsBeta } from "@/hooks/useProjectsBeta"

interface LabsSettingsProps {
  onNavigate: (page: string) => void
}

/**
 * Beta / experimental features the user can opt into. Currently just Projects
 * (board view over multiple lists, with shared membership). Toggling persists
 * to /api/user/settings (projectsBetaEnabled) and reveals the Projects UI.
 */
export default function LabsSettings(_props: LabsSettingsProps) {
  const { enabled, loading, setEnabled } = useProjectsBeta()

  return (
    <div className="p-2 sm:p-4 space-y-4">
      <div className="flex items-center space-x-3">
        <div className="p-2 theme-bg-tertiary rounded-lg">
          <FlaskConical className="w-6 h-6 text-amber-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold theme-text-primary">Beta Features</h1>
          <p className="theme-text-muted">Try features that are still in development.</p>
        </div>
      </div>

      <Card className="theme-bg-secondary theme-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LayoutGrid className="w-5 h-5 text-blue-500" />
              <div>
                <CardTitle className="theme-text-primary flex items-center gap-2">
                  Projects
                  <Badge variant="outline" className="text-amber-500 border-amber-500">Beta</Badge>
                </CardTitle>
                <CardDescription className="theme-text-muted">
                  Group multiple lists into a board (kanban) view with shared members.
                  Sharing a project gives people access to all of its lists.
                </CardDescription>
              </div>
            </div>
            <Switch
              checked={enabled}
              disabled={loading}
              onCheckedChange={setEnabled}
              aria-label="Enable Projects beta"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Label className="text-xs theme-text-muted">
            {enabled
              ? "Projects are enabled. Find them in the sidebar, and turn any list into a board from its settings."
              : "Enable to show Projects in the sidebar and unlock board creation and sharing."}
          </Label>
        </CardContent>
      </Card>
    </div>
  )
}
