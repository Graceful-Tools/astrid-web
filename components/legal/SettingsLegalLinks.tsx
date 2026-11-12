"use client"

import { BRAND } from "@/lib/brand/config"

const LINK = "hover:text-theme-primary transition-colors"
const LABEL = { terms: "Terms of Service", privacy: "Privacy Policy" } as const

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
  return (
    <>
      {pages.map((page) => {
        const external = page === "terms" ? BRAND.termsUrl : BRAND.privacyUrl
        return external ? (
          <a key={page} href={external} target="_blank" rel="noopener noreferrer" className={LINK}>
            {LABEL[page]}
          </a>
        ) : (
          <button key={page} onClick={() => onNavigate(page)} className={LINK}>
            {LABEL[page]}
          </button>
        )
      })}
    </>
  )
}
