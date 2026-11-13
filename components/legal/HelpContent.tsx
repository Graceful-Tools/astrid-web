"use client"

import type { ReactNode } from "react"
import { useTranslations } from "@/lib/i18n/client"
import { richText } from "@/lib/i18n/rich-text"
import { DecisionFormatGuide } from "@/components/docs/DecisionFormatGuide"
import { Smartphone, Globe, ChevronRight } from "lucide-react"
import { BRAND } from '@/lib/brand/config'

/**
 * Help & Troubleshooting, written once (AWTD-1584). The public /help page and the in-app
 * Settings page both render this. The in-app copy had drifted: it told people to search
 * their browser data for a hardcoded product name rather than this deployment's domain.
 *
 * The words live in the `helpPage` namespace of every locale (AWTD-1613). `richText` keeps
 * the bold menu names and keyboard keys inside the translated sentence, so a translator can
 * move them.
 */
const KBD = "px-2 py-0.5 theme-bg-tertiary rounded text-xs"

const TAGS = {
  b: (chunks: string) => <strong>{chunks}</strong>,
  kbd: (chunks: string) => <kbd className={KBD}>{chunks}</kbd>,
}

const LEVEL = {
  simple: "bg-success-subtle text-success",
  intermediate: "bg-warning-subtle text-warning",
  advanced: "bg-danger-subtle text-danger",
} as const

function Level({ level, label, hint, children }: { level: keyof typeof LEVEL; label: string; hint: string; children: ReactNode }) {
  return (
    <div className="theme-surface border theme-border rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className={`px-2 py-1 ${LEVEL[level]} text-xs font-semibold rounded`}>{label}</span>
        <span className="theme-text-secondary text-sm">{hint}</span>
      </div>

      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Step({ number, title, children }: { number: number; title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-8 h-8 theme-bg-tertiary rounded-full flex items-center justify-center text-sm font-bold">{number}</div>
      <div>
        <h3 className="font-semibold theme-text-primary mb-1">{title}</h3>
        <p className="theme-text-secondary text-sm">{children}</p>
      </div>
    </div>
  )
}

function Issue({ title, intro, steps }: { title: string; intro: string; steps: string[] }) {
  return (
    <details className="group theme-surface border theme-border rounded-xl">
      <summary className="flex items-center justify-between p-4 cursor-pointer">
        <span className="font-medium theme-text-primary">{title}</span>
        <ChevronRight className="w-5 h-5 theme-text-secondary group-open:rotate-90 transition-transform" />
      </summary>
      <div className="px-4 pb-4 theme-text-secondary text-sm">
        <p>{intro}</p>
        <ol className="list-decimal list-inside mt-2 space-y-1">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </details>
  )
}

function PlatformHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="p-2 bg-[rgb(var(--theme-accent))] rounded-lg">{icon}</div>
      <h2 className="text-2xl font-bold theme-text-primary">{children}</h2>
    </div>
  )
}

const ISSUES = [
  { id: "counts", steps: 3 },
  { id: "sync", steps: 4 },
  { id: "slow", steps: 4 },
  { id: "signIn", steps: 4 },
] as const

export function HelpContent() {
  const { t: translate } = useTranslations()
  const t = (key: string, values?: Record<string, string>) => translate(`helpPage.${key}`, values)
  const rich = (key: string) => richText(t(key), TAGS)
  const level = (id: keyof typeof LEVEL) => ({ level: id, label: t(`levels.${id}`), hint: t(`levels.${id}Hint`) })

  return (
    <>
      <h1 className="text-4xl font-bold theme-text-primary mb-2">{t("title")}</h1>
      <p className="theme-text-secondary mb-10 text-lg">{t("intro")}</p>

      {/* Quick Navigation */}
      <div className="flex flex-wrap gap-3 mb-10">
        <a href="#ios" className="flex items-center gap-2 px-4 py-2 theme-surface border theme-border hover:bg-[rgb(var(--theme-surface-hover))] rounded-lg text-sm font-medium transition-colors">
          <Smartphone className="w-4 h-4" />
          {t("iosApp")}
        </a>
        <a href="#web" className="flex items-center gap-2 px-4 py-2 theme-surface border theme-border hover:bg-[rgb(var(--theme-surface-hover))] rounded-lg text-sm font-medium transition-colors">
          <Globe className="w-4 h-4" />
          {t("webApp")}
        </a>
      </div>

      {/* iOS Section */}
      <section id="ios" className="mb-16">
        <PlatformHeading icon={<Smartphone className="w-6 h-6 text-[rgb(var(--theme-accent-text))]" />}>{t("iosApp")}</PlatformHeading>

        <div className="space-y-6">
          <Level {...level("simple")}>
            <Step number={1} title={t("ios.pullToRefreshTitle")}>{t("ios.pullToRefreshBody")}</Step>
            <Step number={2} title={t("ios.forceQuitTitle")}>{t("ios.forceQuitBody")}</Step>
          </Level>

          <Level {...level("intermediate")}>
            <Step number={3} title={t("signOutTitle")}>{rich("ios.signOutBody")}</Step>
            <Step number={4} title={t("ios.connectionTitle")}>{t("ios.connectionBody")}</Step>
          </Level>

          <Level {...level("advanced")}>
            <Step number={5} title={t("ios.reinstallTitle")}>{t("ios.reinstallBody")}</Step>
            <Step number={6} title={t("ios.restartTitle")}>{t("ios.restartBody")}</Step>
          </Level>
        </div>
      </section>

      {/* Web Section */}
      <section id="web" className="mb-16">
        <PlatformHeading icon={<Globe className="w-6 h-6 text-[rgb(var(--theme-accent-text))]" />}>{t("webApp")}</PlatformHeading>

        <div className="space-y-6">
          <Level {...level("simple")}>
            <Step number={1} title={t("web.refreshTitle")}>{rich("web.refreshBody")}</Step>
            <Step number={2} title={t("web.hardRefreshTitle")}>{rich("web.hardRefreshBody")}</Step>
          </Level>

          <Level {...level("intermediate")}>
            <Step number={3} title={t("signOutTitle")}>{rich("web.signOutBody")}</Step>
            <Step number={4} title={t("web.browserTitle")}>{t("web.browserBody")}</Step>
            <Step number={5} title={t("web.extensionsTitle")}>{t("web.extensionsBody")}</Step>
          </Level>

          <Level {...level("advanced")}>
            <Step number={6} title={t("web.clearCacheTitle")}>
              {rich("web.clearCacheChrome")}<br />
              {rich("web.clearCacheSafari")}<br />
              {rich("web.clearCacheFirefox")}
            </Step>
            <Step number={7} title={t("web.indexedDbTitle")}>{t("web.indexedDbBody", { wordmark: BRAND.wordmark })}</Step>
          </Level>
        </div>
      </section>

      {/* Decisions and trade-off grids (AWTD-1531) */}
      <section id="decisions" className="mb-16">
        <h2 className="text-2xl font-bold theme-text-primary mb-6">{t("decisionsTitle")}</h2>
        <div className="theme-surface border theme-border rounded-xl p-6">
          <DecisionFormatGuide audience="people" />
        </div>
      </section>

      {/* Common Issues */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold theme-text-primary mb-6">{t("commonIssuesTitle")}</h2>

        <div className="space-y-4">
          {ISSUES.map(({ id, steps }) => (
            <Issue
              key={id}
              title={t(`issues.${id}.title`)}
              intro={t(`issues.${id}.intro`)}
              steps={Array.from({ length: steps }, (_, index) => t(`issues.${id}.step${index + 1}`))}
            />
          ))}
        </div>
      </section>

      {/* Still Need Help */}
      <section className="bg-[rgba(var(--theme-accent),0.1)] border theme-border rounded-xl p-6 text-center">
        <h2 className="text-xl font-bold theme-text-primary mb-2">{t("stillNeedHelpTitle")}</h2>
        <p className="theme-text-secondary mb-4">{t("stillNeedHelpBody")}</p>
        <a
          href={`mailto:${BRAND.supportEmail}`}
          className="inline-flex items-center gap-2 px-6 py-3 bg-[rgb(var(--theme-accent))] hover:bg-[rgb(var(--theme-accent-hover))] text-[rgb(var(--theme-accent-text))] font-medium rounded-xl transition-colors"
        >
          {t("contactSupport")}
        </a>
      </section>
    </>
  )
}
