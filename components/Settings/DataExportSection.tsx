"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Download, FileJson, FileText } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"

/**
 * Stage 14b: data-export card extracted from AccountSettings.
 * Triggers either JSON or CSV export via a parent-supplied callback.
 */
export interface DataExportSectionProps {
  exporting: boolean
  onExport: (format: "json" | "csv") => void
}

export function DataExportSection({ exporting, onExport }: DataExportSectionProps) {
  const { t } = useTranslations()

  return (
    <Card className="theme-bg-secondary theme-border">
      <CardHeader>
        <CardTitle className="theme-text-primary flex items-center space-x-2">
          <Download className="w-5 h-5" />
          <span>{t("settingsPages.exportData.title")}</span>
        </CardTitle>
        <CardDescription className="theme-text-muted">
          {t("settingsPages.exportData.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm theme-text-muted space-y-2">
          <p>{t("settingsPages.exportData.includes")}</p>
          <ul className="list-disc list-inside space-y-1">
            <li>{t("settingsPages.exportData.allTasks")}</li>
            <li>{t("settingsPages.exportData.allLists")}</li>
            <li>{t("settingsPages.exportData.comments")}</li>
            <li>{t("settingsPages.exportData.settings")}</li>
          </ul>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={() => onExport("json")}
            disabled={exporting}
            variant="outline"
            className="flex-1 border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white w-full"
          >
            <FileJson className="w-4 h-4 mr-2" />
            {exporting ? t("settingsPages.exportData.exporting") : t("settingsPages.exportData.exportJson")}
          </Button>
          <Button
            onClick={() => onExport("csv")}
            disabled={exporting}
            variant="outline"
            className="flex-1 border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white w-full"
          >
            <FileText className="w-4 h-4 mr-2" />
            {exporting ? t("settingsPages.exportData.exporting") : t("settingsPages.exportData.exportCsv")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
