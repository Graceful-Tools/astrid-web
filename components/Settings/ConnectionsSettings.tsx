"use client"

/**
 * Settings → Connections: what can act as this account.
 *
 * Replaces API Access, which was a developer console for creating OAuth apps
 * — a page most readers never needed (an OAuth-capable assistant registers
 * itself on connect) and one that could not answer the question people
 * actually brought to it: "what has access to my account, and how do I
 * stop it?". The audit list answers that; the console lives on underneath
 * it, collapsed, for the readers who do need it.
 */

import { BRAND } from '@/lib/brand/config'
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ConnectionsList } from "@/components/connections-list"
import { OAuthAppManager } from "@/components/oauth-app-manager"
import { useTranslations } from "@/lib/i18n/client"
import { Check, ChevronDown, ChevronUp, Code2, Copy, Link2 } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"

interface ConnectionsSettingsProps {
  onNavigate: (page: string) => void
}

type CopyFieldProps = {
  label: string
  value: string
  field: string
  onCopy: (value: string, field: string) => Promise<void>
  copiedField: string | null
}

const CopyField = ({ label, value, field, onCopy, copiedField }: CopyFieldProps) => (
  <div className="flex items-center gap-2">
    <div className="flex-1">
      <div className="text-xs uppercase tracking-wide theme-text-muted mb-1">{label}</div>
      <div className="font-mono text-xs sm:text-sm theme-bg-tertiary rounded px-2 py-1 break-all">
        {value}
      </div>
    </div>
    <Button
      variant="outline"
      size="icon"
      className="shrink-0"
      onClick={() => onCopy(value, field)}
      aria-label={`Copy ${label}`}
    >
      {copiedField === field ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </Button>
  </div>
)

/**
 * The OpenAPI / GPT-actions hand-off: the URLs an assistant that does not
 * speak MCP needs. MCP connect snippets are NOT repeated here — the agents
 * page and /docs/loops own them, and a second copy is how they drift.
 */
function OpenApiIntegration() {
  const { t } = useTranslations()
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const defaultOrigin = process.env.NEXT_PUBLIC_BASE_URL || `https://${BRAND.domain}`
  const [hostOrigin, setHostOrigin] = useState(defaultOrigin)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostOrigin(`${window.location.protocol}//${window.location.host}`)
    }
  }, [])

  const copyValue = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedField(field)
      toast.success(t("common.copiedToClipboard"))
      setTimeout(() => setCopiedField(null), 2000)
    } catch (error) {
      console.error("Failed to copy", error)
      toast.error(t("common.unableToCopy"))
    }
  }

  const fields = [
    { label: t("settingsPages.aiIntegrations.step1.redirectUri"), value: "https://chat.openai.com/aip/api/v1/oauth/callback", field: "redirect" },
    { label: t("settingsPages.aiIntegrations.step1.scopes"), value: "tasks:read tasks:write lists:read comments:write", field: "scopes" },
    { label: t("settingsPages.aiIntegrations.step2.manifestUrl"), value: `${hostOrigin}/.well-known/ai-plugin.json`, field: "manifest" },
    { label: t("settingsPages.aiIntegrations.step2.openapiSpec"), value: `${hostOrigin}/.well-known/astrid-openapi.yaml`, field: "openapi" },
    { label: t("settingsPages.aiIntegrations.step2.authUrl"), value: `${hostOrigin}/oauth/authorize`, field: "authUrl" },
    { label: t("settingsPages.aiIntegrations.step2.tokenUrl"), value: `${hostOrigin}/api/v1/oauth/token`, field: "tokenUrl" },
  ]

  return (
    <div className="border-t theme-border pt-4 space-y-3">
      <div className="flex items-center space-x-2">
        <Badge variant="outline" className="text-xs">{t("settingsPages.aiIntegrations.step2.badge")}</Badge>
        <span className="font-medium theme-text-primary">{t("settingsPages.aiIntegrations.step2.title")}</span>
      </div>
      <p className="text-sm theme-text-muted">{t("settingsPages.aiIntegrations.step1.description")}</p>
      <div className="grid gap-3">
        {fields.map(f => (
          <CopyField key={f.field} {...f} onCopy={copyValue} copiedField={copiedField} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 pt-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/api-testing">{t("settingsPages.connections.developer.openTester")}</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="https://chat.openai.com/gpts/editor" target="_blank" rel="noreferrer">
            {t("settingsPages.aiIntegrations.moreDetails.openBuilderButton")}
          </Link>
        </Button>
      </div>
    </div>
  )
}

// onNavigate stays in the signature — the settings registry passes it to every page.
export default function ConnectionsSettings(_props: ConnectionsSettingsProps) {
  const { t } = useTranslations()
  const [showDeveloper, setShowDeveloper] = useState(false)

  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-4xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link2 className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold theme-text-primary">{t("settingsPages.connections.title")}</h1>
            <p className="theme-text-muted">{t("settingsPages.connections.description")}</p>
          </div>
        </div>

        <Card className="theme-bg-secondary theme-border">
          <CardContent className="pt-6">
            <ConnectionsList />
          </CardContent>
        </Card>

        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <div
              className="flex items-center justify-between cursor-pointer"
              onClick={() => setShowDeveloper(!showDeveloper)}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
                  <Code2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="theme-text-primary">{t("settingsPages.connections.developer.title")}</CardTitle>
                  <CardDescription className="theme-text-muted">
                    {t("settingsPages.connections.developer.description")}
                  </CardDescription>
                </div>
              </div>
              <Button variant="ghost" size="sm">
                {showDeveloper ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </div>
          </CardHeader>
          {showDeveloper && (
            <CardContent className="space-y-6 pt-0">
              <div className="flex flex-wrap gap-2">
                <Link href="/docs" className="text-xs text-blue-500 hover:underline">
                  API Documentation
                </Link>
                <span className="text-xs theme-text-muted">&middot;</span>
                <Link href="/docs/integrate" className="text-xs text-blue-500 hover:underline">
                  Integration Guide
                </Link>
              </div>
              <OAuthAppManager />
              <OpenApiIntegration />
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  )
}
