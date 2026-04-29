"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { AlertCircle, CheckCircle, Clock, Mail, RefreshCw, X } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"
import type { AccountData } from "./AccountSettings"

/**
 * Stage 14a: extracted from AccountSettings.tsx — the Email Verification
 * card. Owns its own translations call (per the plan: child components
 * call useTranslations themselves rather than receiving `t` as a prop).
 *
 * The mutating actions (resend / cancel) stay in the parent because they
 * also touch parent-owned account state via loadAccountData(); they're
 * passed in as callbacks so this component is purely presentational.
 */
export interface EmailVerificationSectionProps {
  accountData: AccountData
  resendingVerification: boolean
  onResendVerification: () => void
  onCancelEmailChange: () => void
}

export function EmailVerificationSection({
  accountData,
  resendingVerification,
  onResendVerification,
  onCancelEmailChange,
}: EmailVerificationSectionProps) {
  const { t } = useTranslations()

  return (
    <Card className="theme-bg-secondary theme-border">
      <CardHeader>
        <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
          <Mail className="w-5 h-5" />
          <span>{t("settingsPages.emailVerification.title")}</span>
        </CardTitle>
        <CardDescription className="theme-text-muted">
          {t("settingsPages.emailVerification.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Email Status */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3 theme-bg-tertiary rounded-lg">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <Mail className="w-4 h-4 theme-text-muted shrink-0" />
            <div className="min-w-0">
              <div className="theme-text-primary text-sm truncate">{accountData.email || "Loading..."}</div>
              <div className="flex items-center space-x-2">
                {accountData.verified ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    <span className="text-green-500 text-xs">
                      {accountData.verifiedViaOAuth
                        ? t("settingsPages.emailVerification.verifiedViaGoogle")
                        : t("settingsPages.emailVerification.verified")}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0" />
                    <span className="text-yellow-500 text-xs">{t("settingsPages.emailVerification.notVerified")}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {!accountData.verified && !accountData.verifiedViaOAuth && (
            <Button
              onClick={onResendVerification}
              disabled={resendingVerification}
              size="sm"
              variant="outline"
              className="border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white w-full sm:w-auto"
            >
              {resendingVerification ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                t("settingsPages.emailVerification.verify")
              )}
            </Button>
          )}
        </div>

        {/* Pending Email Change */}
        {accountData.hasPendingChange && accountData.pendingEmail && (
          <Alert className="border-yellow-600 bg-yellow-900/20">
            <Clock className="w-4 h-4" />
            <AlertDescription className="text-yellow-400">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Pending email change</p>
                  <p className="text-sm">Waiting for verification: {accountData.pendingEmail || "Unknown"}</p>
                </div>
                <Button
                  onClick={onCancelEmailChange}
                  size="sm"
                  variant="ghost"
                  className="text-yellow-400 hover:text-yellow-300"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Verification Info */}
        <div className="text-sm theme-text-muted space-y-1">
          <p>• Verified emails help us protect your account and enable collaboration</p>
          {accountData.verifiedViaOAuth ? (
            <p>• Your email is verified through Google OAuth</p>
          ) : (
            <p>• Check your email for a verification link after signing up</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
