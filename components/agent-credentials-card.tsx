"use client"

/**
 * Inline client credentials for a transport the agents page configures.
 *
 * The GitHub Actions recipe and the webhook transport both need a
 * client_credentials pair. They used to send the reader to the developer
 * console to make one — a form about grant types and redirect URIs that
 * asked questions the transport had already answered. This card asks the
 * server for the preset that fits (lib/oauth/oauth-client-presets.ts) and
 * shows the pair once, where the reader already is.
 */

import { useState } from 'react'
import Link from 'next/link'
import { KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CredentialField, copyCredential } from '@/components/credential-field'
import { apiPost } from '@/lib/api'
import { useTranslations } from '@/lib/i18n/client'
import type { OAuthClientPreset } from '@/lib/oauth/oauth-client-presets'

/** The repository secrets the GitHub Actions recipe reads. */
export const ACTIONS_SECRET_NAMES = {
  clientId: 'ASTRID_CLIENT_ID',
  clientSecret: 'ASTRID_CLIENT_SECRET',
} as const

interface MintedCredentials {
  clientId: string
  clientSecret: string
}

export function AgentCredentialsCard({
  preset,
  agent,
}: {
  preset: OAuthClientPreset
  /** Agent mailbox the client is minted for — it names the client. */
  agent: string
}) {
  const { t } = useTranslations()
  const [credentials, setCredentials] = useState<MintedCredentials | null>(null)
  const [busy, setBusy] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const copy = async (text: string, field: string) => {
    await copyCredential(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const create = async () => {
    setBusy(true)
    try {
      const response = await apiPost('/api/v1/oauth/clients', { preset, agent })
      const data: { client?: MintedCredentials } = await response.json()
      if (!data.client?.clientId || !data.client.clientSecret) {
        throw new Error('Incomplete credentials response')
      }
      setCredentials(data.client)
    } catch {
      toast.error(t('settingsPages.aiAgents.credentials.error'))
    } finally {
      setBusy(false)
    }
  }

  if (!credentials) {
    return (
      <Button size="sm" variant="outline" onClick={create} disabled={busy}>
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
        {t(busy ? 'settingsPages.aiAgents.credentials.creating' : 'settingsPages.aiAgents.credentials.create')}
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border theme-border p-3">
      <p className="text-xs font-medium text-red-400">
        {t('settingsPages.aiAgents.credentials.shownOnce')}
      </p>
      <CredentialField
        label={t('settingsPages.aiAgents.credentials.clientId')}
        value={credentials.clientId}
        field="clientId"
        copiedField={copiedField}
        onCopy={copy}
      />
      <CredentialField
        label={t('settingsPages.aiAgents.credentials.clientSecret')}
        value={credentials.clientSecret}
        field="clientSecret"
        copiedField={copiedField}
        onCopy={copy}
        sensitive
      />
      <p className="text-xs theme-text-muted">
        {preset === 'githubActions'
          ? t('settingsPages.aiAgents.credentials.saveAsSecrets', {
              clientIdSecret: ACTIONS_SECRET_NAMES.clientId,
              clientSecretSecret: ACTIONS_SECRET_NAMES.clientSecret,
            })
          : t('settingsPages.aiAgents.credentials.sdkNeedsBoth')}
      </p>
      <p className="text-xs">
        <Link href="/settings/api-access" className="text-blue-500 hover:underline">
          {t('settingsPages.aiAgents.credentials.manage')}
        </Link>
      </p>
    </div>
  )
}
