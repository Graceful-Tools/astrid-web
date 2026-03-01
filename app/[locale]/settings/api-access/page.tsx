"use client"

export const dynamic = 'force-dynamic'

import { useEffect, Suspense, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { LoadingScreen } from "@/components/loading-screen"
import { OAuthAppManager } from "@/components/oauth-app-manager"
import { useTranslations } from "@/lib/i18n/client"
import {
  ArrowLeft,
  Code2,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Shield,
  Sparkles,
  LinkIcon
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { toast } from "sonner"

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

function APIAccessSettingsContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { t } = useTranslations()
  const [showChatGPT, setShowChatGPT] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const defaultOrigin = process.env.NEXT_PUBLIC_BASE_URL || "https://astrid.cc"
  const [hostOrigin, setHostOrigin] = useState(defaultOrigin)

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth/signin")
      return
    }
  }, [status, router])

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

  if (status === "loading") {
    return <LoadingScreen message={t("settingsPages.apiAccess.loading")} />
  }

  if (!session?.user) {
    return <LoadingScreen message={t("settingsPages.apiAccess.loading")} />
  }

  const manifestUrl = `${hostOrigin}/.well-known/ai-plugin.json`
  const openApiUrl = `${hostOrigin}/.well-known/astrid-openapi.yaml`
  const authUrl = `${hostOrigin}/oauth/authorize`
  const tokenUrl = `${hostOrigin}/api/v1/oauth/token`
  const redirectUri = "https://chat.openai.com/aip/api/v1/oauth/callback"
  const scopes = "tasks:read tasks:write lists:read comments:write"
  const remoteMcpUrl = `${hostOrigin}/mcp`
  const remoteMcpPostUrl = `${hostOrigin}/mcp/messages`

  return (
    <div className="min-h-screen theme-bg-primary">
      {/* Header */}
      <div className="theme-header theme-border app-header">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push('/settings')}
            className="p-2 hover:bg-opacity-20"
          >
            <ArrowLeft className="w-5 h-5 theme-text-primary" />
          </Button>
          <div
            className="flex flex-wrap items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => router.push('/')}
            title="Go to Home"
          >
            <Image src="/icons/icon-96x96.png" alt="Astrid" width={24} height={24} className="rounded" />
            <span className="text-xl font-semibold theme-text-primary">astrid</span>
          </div>
          <div className="flex items-center space-x-1 theme-count-bg rounded-full px-3 py-1">
            <div className="w-2 h-2 theme-bg-tertiary rounded-full"></div>
            <span className="text-sm theme-text-primary">{t("settingsPages.apiAccess.title")}</span>
          </div>
        </div>
      </div>

      {/* Settings Content */}
      <div className="p-2 sm:p-4">
        <div className="max-w-sm sm:max-w-4xl mx-auto space-y-4 sm:space-y-6">
          {/* Settings Page Header */}
          <div className="flex flex-wrap items-center gap-3">
            <Code2 className="w-8 h-8 text-blue-500" />
            <div>
              <h1 className="text-2xl font-bold theme-text-primary">{t("settingsPages.apiAccess.title")}</h1>
              <p className="theme-text-muted">{t("settingsPages.apiAccess.description")}</p>
            </div>
          </div>

          {/* Documentation Links */}
          <div className="flex flex-wrap gap-2">
            <Link href="/docs" className="text-xs text-blue-500 hover:underline">
              API Documentation
            </Link>
            <span className="text-xs theme-text-muted">&middot;</span>
            <Link href="/docs/integrate" className="text-xs text-blue-500 hover:underline">
              Integration Guide
            </Link>
          </div>

          {/* OAuth App Manager - the main functionality */}
          <OAuthAppManager />

          {/* ChatGPT Integration Section */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setShowChatGPT(!showChatGPT)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="theme-text-primary">{t("settingsPages.chatgpt.title")}</CardTitle>
                    <CardDescription className="theme-text-muted">
                      {t("settingsPages.chatgpt.description")}
                    </CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm">
                  {showChatGPT ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              </div>
            </CardHeader>

            {showChatGPT && (
              <CardContent className="space-y-6 pt-0">
                {/* How it works */}
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <Shield className="w-5 h-5 text-green-500" />
                    <div>
                      <div className="font-semibold theme-text-primary">{t("settingsPages.chatgpt.howItWorks.oauth.title")}</div>
                      <p className="text-sm theme-text-muted">
                        {t("settingsPages.chatgpt.howItWorks.oauth.description")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Sparkles className="w-5 h-5 text-purple-500" />
                    <div>
                      <div className="font-semibold theme-text-primary">{t("settingsPages.chatgpt.howItWorks.openapi.title")}</div>
                      <p className="text-sm theme-text-muted">
                        {t("settingsPages.chatgpt.howItWorks.openapi.description")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <LinkIcon className="w-5 h-5 text-blue-500" />
                    <div>
                      <div className="font-semibold theme-text-primary">{t("settingsPages.chatgpt.howItWorks.shareable.title")}</div>
                      <p className="text-sm theme-text-muted">
                        {t("settingsPages.chatgpt.howItWorks.shareable.description")}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Step 1: Create OAuth App */}
                <div className="border-t theme-border pt-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <Badge variant="outline" className="text-xs">{t("settingsPages.chatgpt.step1.badge")}</Badge>
                    <span className="font-medium theme-text-primary">{t("settingsPages.chatgpt.step1.title")}</span>
                  </div>
                  <p className="text-sm theme-text-muted mb-3">
                    {t("settingsPages.chatgpt.step1.description")}
                  </p>
                  <div className="grid gap-3">
                    <CopyField
                      label={t("settingsPages.chatgpt.step1.redirectUri")}
                      value={redirectUri}
                      field="redirect"
                      onCopy={copyValue}
                      copiedField={copiedField}
                    />
                    <CopyField
                      label={t("settingsPages.chatgpt.step1.scopes")}
                      value={scopes}
                      field="scopes"
                      onCopy={copyValue}
                      copiedField={copiedField}
                    />
                  </div>
                </div>

                {/* Step 2: URLs */}
                <div className="border-t theme-border pt-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <Badge variant="outline" className="text-xs">{t("settingsPages.chatgpt.step2.badge")}</Badge>
                    <span className="font-medium theme-text-primary">{t("settingsPages.chatgpt.step2.title")}</span>
                  </div>
                  <p className="text-sm theme-text-muted mb-3">
                    {t("settingsPages.chatgpt.step2.description")}
                  </p>
                  <div className="grid gap-3">
                    <CopyField
                      label={t("settingsPages.chatgpt.step2.manifestUrl")}
                      value={manifestUrl}
                      field="manifest"
                      onCopy={copyValue}
                      copiedField={copiedField}
                    />
                    <CopyField
                      label={t("settingsPages.chatgpt.step2.openapiSpec")}
                      value={openApiUrl}
                      field="openapi"
                      onCopy={copyValue}
                      copiedField={copiedField}
                    />
                    <CopyField
                      label={t("settingsPages.chatgpt.step2.authUrl")}
                      value={authUrl}
                      field="authUrl"
                      onCopy={copyValue}
                      copiedField={copiedField}
                    />
                    <CopyField
                      label={t("settingsPages.chatgpt.step2.tokenUrl")}
                      value={tokenUrl}
                      field="tokenUrl"
                      onCopy={copyValue}
                      copiedField={copiedField}
                    />
                  </div>
                </div>

                {/* Step 2b: MCP */}
                <div className="border-t theme-border pt-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <Badge variant="outline" className="text-xs">{t("settingsPages.chatgpt.step2b.badge")}</Badge>
                    <span className="font-medium theme-text-primary">{t("settingsPages.chatgpt.step2b.title")}</span>
                  </div>
                  <p className="text-sm theme-text-muted mb-3">
                    {t("settingsPages.chatgpt.step2b.description")}
                  </p>
                  <div className="grid gap-3">
                    <CopyField
                      label={t("settingsPages.chatgpt.step2b.serverUrl")}
                      value={remoteMcpUrl}
                      field="mcpServer"
                      onCopy={copyValue}
                      copiedField={copiedField}
                    />
                    <CopyField
                      label={t("settingsPages.chatgpt.step2b.postEndpoint")}
                      value={remoteMcpPostUrl}
                      field="mcpPost"
                      onCopy={copyValue}
                      copiedField={copiedField}
                    />
                  </div>
                </div>

                {/* Links */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/settings/api-testing">{t("settingsPages.chatgpt.step2.testApiButton")}</Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="https://chat.openai.com/gpts/editor" target="_blank" rel="noreferrer">
                      {t("settingsPages.chatgpt.moreDetails.openBuilderButton")}
                    </Link>
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function APIAccessSettingsPage() {
  const { t } = useTranslations()

  return (
    <Suspense fallback={<LoadingScreen message={t("settingsPages.apiAccess.loading")} />}>
      <APIAccessSettingsContent />
    </Suspense>
  )
}
