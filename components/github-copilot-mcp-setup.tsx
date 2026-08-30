"use client"

import { useState } from "react"
import { AlertCircle, Check, Copy, ExternalLink, Github, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { BRAND } from "@/lib/brand/config"
import { apiPost } from "@/lib/api"
import { useTranslations } from "@/lib/i18n/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const GITHUB_MCP_DOCS =
  "https://docs.github.com/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers"

function CopyBlock({
  label,
  value,
  field,
  copiedField,
  onCopy,
  testId,
}: {
  label: string
  value: string
  field: string
  copiedField: string | null
  onCopy: (value: string, field: string) => Promise<void>
  testId?: string
}) {
  const { t } = useTranslations()

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium theme-text-muted">{label}</span>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onCopy(value, field)}>
          {copiedField === field
            ? <Check className="w-3.5 h-3.5 text-green-500" />
            : <Copy className="w-3.5 h-3.5" />}
          <span className="ml-1 text-xs">
            {t(copiedField === field ? "common.copied" : "common.copy")}
          </span>
        </Button>
      </div>
      <pre className="p-3 theme-bg-tertiary rounded-lg overflow-x-auto">
        <code
          className="text-xs font-mono theme-text-primary whitespace-pre-wrap break-all"
          data-testid={testId}
        >
          {value}
        </code>
      </pre>
    </div>
  )
}

export function GitHubCopilotMcpSetup({ origin }: { origin?: string }) {
  const { t } = useTranslations()
  const [token, setToken] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const mcpOrigin = origin || process.env.NEXT_PUBLIC_BASE_URL || `https://${BRAND.domain}`
  const secretName = `COPILOT_MCP_${BRAND.wordmark.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_TOKEN`
  const config = JSON.stringify({
    mcpServers: {
      [BRAND.wordmark.toLowerCase()]: {
        type: "http",
        url: `${mcpOrigin}/mcp`,
        headers: {
          Authorization: `Bearer $${secretName}`,
        },
        tools: ["*"],
      },
    },
  }, null, 2)

  const copy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      toast.error(t("common.unableToCopy"))
    }
  }

  const createSetup = async () => {
    setCreating(true)
    try {
      const response = await apiPost("/api/mcp/user-tokens", {
        permissions: ["read", "write"],
        expiresInDays: 365,
        description: "GitHub Copilot cloud agent",
      })

      if (!response.ok) {
        throw new Error("Token request failed")
      }

      const data: { token?: string } = await response.json()
      if (!data.token) {
        throw new Error("Token response was incomplete")
      }
      setToken(data.token)
    } catch {
      toast.error(t("settingsPages.aiAgents.githubMcp.createError"))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card className="theme-bg-secondary theme-border border-blue-500/30">
      <CardHeader>
        <CardTitle className="theme-text-primary flex items-center gap-2">
          <Github className="w-5 h-5" />
          {t("settingsPages.aiAgents.githubMcp.title", { appName: BRAND.appName })}
        </CardTitle>
        <CardDescription className="theme-text-muted">
          {t("settingsPages.aiAgents.githubMcp.description", { appName: BRAND.appName })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t("settingsPages.aiAgents.githubMcp.oauthWarning", { appName: BRAND.appName })}
          </AlertDescription>
        </Alert>

        {!token ? (
          <Button onClick={createSetup} disabled={creating} className="w-full sm:w-auto">
            {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t(creating
              ? "settingsPages.aiAgents.githubMcp.creating"
              : "settingsPages.aiAgents.githubMcp.create")}
          </Button>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm theme-text-secondary">
                <strong>1.</strong>{" "}
                {t("settingsPages.aiAgents.githubMcp.secretStep", { secretName })}
              </p>
              <CopyBlock
                label={t("settingsPages.aiAgents.githubMcp.tokenLabel")}
                value={token}
                field="token"
                copiedField={copiedField}
                onCopy={copy}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm theme-text-secondary">
                <strong>2.</strong> {t("settingsPages.aiAgents.githubMcp.configStep")}
              </p>
              <CopyBlock
                label={t("settingsPages.aiAgents.githubMcp.configLabel")}
                value={config}
                field="config"
                copiedField={copiedField}
                onCopy={copy}
                testId="github-copilot-mcp-config"
              />
            </div>

            <Button variant="outline" asChild>
              <a href={GITHUB_MCP_DOCS} target="_blank" rel="noreferrer">
                {t("settingsPages.aiAgents.githubMcp.openGitHub")}
                <ExternalLink className="w-4 h-4 ml-2" />
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
