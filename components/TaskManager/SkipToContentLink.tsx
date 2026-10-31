"use client"

import { useTranslations } from "@/lib/i18n/client"

/**
 * First Tab stop in the app shell; visible only while focused (AWTD-1435).
 * Targets the `<main id="main-content">` in TaskManagerView.
 */
export function SkipToContentLink() {
  const { t } = useTranslations()
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[1000] focus:rounded-md focus:px-3 focus:py-2 focus:text-sm focus:font-medium theme-bg-primary theme-text-primary"
    >
      {t("navigation.skipToContent")}
    </a>
  )
}
