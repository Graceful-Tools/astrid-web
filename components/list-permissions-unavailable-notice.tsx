"use client"

import { ShieldAlert } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"

/**
 * Shown when the browser cannot answer list-permission questions (ADEV-304): astrid-core's
 * browser door is switched off, failed to load, or does not answer `listAccess`. There is no
 * TypeScript rule to fall back to, so every permission check is refused and the app is drawn
 * read-only; this says why, instead of edit controls silently missing.
 */
export function ListPermissionsUnavailableNotice() {
  const { t } = useTranslations()
  return (
    <div
      role="alert"
      className="fixed top-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm z-50"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg shadow-lg bg-theme-surface text-theme-primary border border-warning">
        <div className="flex items-center gap-2 flex-1">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 text-warning" aria-hidden="true" />
          <span className="text-sm font-medium">{t("permissions.unavailable")}</span>
        </div>
        <button
          type="button"
          className="text-sm font-medium underline"
          onClick={() => window.location.reload()}
        >
          {t("permissions.reload")}
        </button>
      </div>
    </div>
  )
}
