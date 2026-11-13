"use client"

import { BRAND } from "@/lib/brand/config"
import { useTranslations } from "@/lib/i18n/client"

const LINK = "hover:text-theme-primary transition-colors"
const LABEL = { terms: "legalPages.termsOfService", privacy: "legalPages.privacyPolicy" } as const

/**
 * Footer links between the in-app Terms, Privacy and Help panels (AWTD-1584). A page the
 * operator publishes elsewhere opens there; otherwise the link swaps the Settings panel.
 */
export function SettingsLegalLinks({
  pages,
  onNavigate,
}: {
  pages: Array<"terms" | "privacy">
  onNavigate: (page: string) => void
}) {
  const { t } = useTranslations()
  return (
    <>
      {pages.map((page) => {
        const external = page === "terms" ? BRAND.termsUrl : BRAND.privacyUrl
        return external ? (
          <a key={page} href={external} target="_blank" rel="noopener noreferrer" className={LINK}>
            {t(LABEL[page])}
          </a>
        ) : (
          <button key={page} onClick={() => onNavigate(page)} className={LINK}>
            {t(LABEL[page])}
          </button>
        )
      })}
    </>
  )
}
