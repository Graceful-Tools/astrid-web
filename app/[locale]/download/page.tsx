import { BRAND } from '@/lib/brand/config'
import Link from "next/link"
import Image from "next/image"
import { getTranslations } from "next-intl/server"
import { ScrollShell } from "@/components/scroll-shell"
import { fetchLatestMacRelease, MAC_RELEASES_FALLBACK_URL } from "@/lib/mac-release"

export const metadata = {
  title: `Download ${BRAND.appName} for Mac`,
  description: `${BRAND.appName} for Mac — a native desktop app for your tasks, lists, and chat.`,
}

export default async function DownloadPage() {
  // The DMG lives on GitHub Releases (free bandwidth, versioned). Resolving the
  // newest release per request means publishing a release is the only step
  // needed to ship an update.
  //
  // The lookup is shared with GET /api/v1/app-version so the two cannot
  // disagree about the newest Mac build: when that endpoint hardcoded its own
  // number, it advertised a version this page could not offer (AWTD-942).
  const mac = await fetchLatestMacRelease()
  const t = await getTranslations("downloadPage")

  return (
    <ScrollShell className="theme-bg-primary theme-text-primary">
      <header className="border-b theme-border theme-bg-secondary">
        <div className="container mx-auto px-4 py-6">
          <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
            <Image src={BRAND.iconSmall} alt={BRAND.appName} width={32} height={32} className="rounded" />
            <span className="text-2xl font-bold theme-text-primary">{BRAND.wordmark}</span>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-4xl font-bold theme-text-primary mb-2">{t("title")}</h1>
        <p className="theme-text-secondary mb-10">
          {t("subtitle")}
        </p>

        {/* Mac */}
        <section className="rounded-xl border theme-border theme-surface p-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold theme-text-primary mb-1">{t("macTitle")}</h2>
              <p className="theme-text-secondary text-sm">
                {mac
                  ? t("macRelease", { version: mac.version, size: mac.size, published: mac.published })
                  : t("macRequirements")}
              </p>
            </div>
            <a
              href={mac?.url ?? MAC_RELEASES_FALLBACK_URL}
              className="inline-flex items-center rounded-lg bg-[rgb(var(--theme-accent))] px-5 py-2.5 font-semibold text-[rgb(var(--theme-accent-text))] transition-colors hover:bg-[rgb(var(--theme-accent-hover))]"
            >
              {mac ? t("downloadForMac") : t("viewReleases")}
            </a>
          </div>
          <ul className="mt-5 grid gap-2 text-sm theme-text-secondary sm:grid-cols-2">
            <li>• {t("featureQuickAdd")}</li>
            <li>• {t("featureViews")}</li>
            <li>• {t("featureOffline")}</li>
            <li>• {t("featureApple")}</li>
          </ul>
          <p className="mt-5 text-xs theme-text-muted">
            {t("installNote")}
          </p>
        </section>

        {/* iPhone & iPad */}
        <section className="rounded-xl border theme-border theme-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold theme-text-primary mb-1">{t("iosTitle")}</h2>
              <p className="theme-text-secondary text-sm">{t("iosBeta")}</p>
            </div>
            <a
              href="https://testflight.apple.com/join/V11WpM3d"
              className="inline-flex items-center rounded-lg border theme-border-input px-5 py-2.5 font-semibold theme-text-primary transition-colors hover:bg-[rgb(var(--theme-surface-hover))]"
            >
              {t("joinBeta")}
            </a>
          </div>
        </section>

        <p className="mt-10 text-sm theme-text-muted">
          {t("preferBrowser")}{" "}
          <Link href="/" className="theme-text-primary underline underline-offset-4 hover:opacity-80">
            {t("useOnWeb")}
          </Link>
          .
        </p>
      </main>
    </ScrollShell>
  )
}
