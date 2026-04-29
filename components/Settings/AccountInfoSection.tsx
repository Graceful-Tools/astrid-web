"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslations } from "@/lib/i18n/client"
import type { AccountData } from "./AccountSettings"

/**
 * Stage 14b: read-only account metadata card extracted from AccountSettings.
 * Pure presentational; no callbacks or local state.
 */
export interface AccountInfoSectionProps {
  accountData: AccountData
}

export function AccountInfoSection({ accountData }: AccountInfoSectionProps) {
  const { t } = useTranslations()

  return (
    <Card className="theme-bg-secondary theme-border">
      <CardHeader>
        <CardTitle className="theme-text-primary">{t("settingsPages.accountInfo.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="theme-text-muted">{t("settingsPages.accountInfo.created")}</span>
          <span className="theme-text-primary">{new Date(accountData.createdAt).toLocaleDateString()}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="theme-text-muted">{t("settingsPages.accountInfo.lastUpdated")}</span>
          <span className="theme-text-primary">{new Date(accountData.updatedAt).toLocaleDateString()}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="theme-text-muted">{t("settingsPages.accountInfo.accountId")}</span>
          <span className="theme-text-primary font-mono text-xs">{accountData.id}</span>
        </div>
      </CardContent>
    </Card>
  )
}
