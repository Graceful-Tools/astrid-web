import type { ReactNode } from "react"
import Link from "next/link"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { BRAND, brandLegalHref } from "@/lib/brand/config"
import { ScrollShell } from "@/components/scroll-shell"
import { LegalFooter } from "./LegalFooter"

const LINK = "hover:text-[rgb(var(--theme-text-primary))] transition-colors"

/**
 * The chrome around a public legal or help page: the brand header, the content column
 * and the footer links (AWTD-1584). `links` names which sibling pages the footer offers.
 * The legal text itself stays in English (AWTD-1613); the chrome around it follows the
 * reader's language. The link names are `legalPages.*`, not the sign-in page's keys: those
 * are declined to fit inside "you agree to our …" (Russian puts them in the accusative).
 */
export function LegalPageShell({
  width,
  links,
  children,
}: {
  width: "max-w-3xl" | "max-w-4xl"
  links: Array<"terms" | "privacy">
  children: ReactNode
}) {
  const t = useTranslations("legalPages")
  return (
    <ScrollShell className="theme-bg-primary theme-text-primary">
      {/* Header */}
      <header className="border-b theme-border theme-bg-secondary">
        <div className="container mx-auto px-4 py-6">
          <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
            <Image src={BRAND.iconSmall} alt={BRAND.appName} width={32} height={32} className="rounded" />
            <span className="text-2xl font-bold theme-text-primary">{BRAND.wordmark}</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className={`container mx-auto px-4 py-12 ${width}`}>
        {children}

        <LegalFooter surface="page">
          {links.includes("terms") && (
            <Link href={brandLegalHref("terms")} className={LINK}>
              {t("termsOfService")}
            </Link>
          )}
          {links.includes("privacy") && (
            <Link href={brandLegalHref("privacy")} className={LINK}>
              {t("privacyPolicy")}
            </Link>
          )}
          <Link href="/" className={LINK}>
            {t("backToHome")}
          </Link>
        </LegalFooter>
      </main>
    </ScrollShell>
  )
}
