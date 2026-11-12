import type { ReactNode } from "react"
import { BRAND } from "@/lib/brand/config"

/**
 * The copyright line and links under the Terms, Privacy and Help pages (AWTD-1584).
 *
 * The copyright holder is `BRAND.operatorName`. It was a literal "Graceful Tools LLC" in
 * six places, so every partner deployment claimed copyright for someone else's company.
 * `surface` keeps each page's existing look: the public routes and the Settings panel
 * style their footers differently, and this change is about the words, not the styling.
 */
export function LegalFooter({ surface, children }: { surface: "page" | "settings"; children: ReactNode }) {
  return (
    <div className={`mt-12 pt-8 border-t ${surface === "page" ? "theme-border" : "border-theme"}`}>
      <div className={`flex flex-col sm:flex-row gap-4 justify-between items-center text-sm ${surface === "page" ? "theme-text-secondary" : "text-theme-muted"}`}>
        <p>&copy; {new Date().getFullYear()} {BRAND.operatorName}</p>
        <div className="flex gap-6">{children}</div>
      </div>
    </div>
  )
}
