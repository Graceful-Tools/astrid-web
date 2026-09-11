'use client'

/**
 * Task 10f26dc6: say when a manual OAuth client is (not) needed.
 *
 * An OAuth-capable assistant registers itself through dynamic client
 * registration when it connects to the hosted MCP endpoint, so creating a
 * client here is redundant for it — and the redundant client is what produced
 * the `invalid_client` failures this copy exists to prevent. Its own
 * component so the settings panel stays the list, not the explanation.
 */

import { Card, CardContent } from '@/components/ui/card'
import { useTranslations } from '@/lib/i18n/client'
import type { GrantType } from '@/types/oauth'

/**
 * The grant types a manually created client can hold — which is the same
 * question the guidance above answers, so the list and the explanation of
 * when to use it live together rather than drifting apart.
 */
export const GRANT_TYPE_OPTIONS: Array<{
  value: GrantType
  label: string
  description: string
}> = [
  {
    value: 'client_credentials',
    label: 'Client Credentials',
    description: 'Server-to-server access (no user login required)',
  },
  {
    value: 'authorization_code',
    label: 'Authorization Code',
    description: 'User consent via browser (ChatGPT, third-party apps)',
  },
  {
    value: 'refresh_token',
    label: 'Refresh Token',
    description: 'Issue refresh tokens to keep sessions active',
  },
]

export function OAuthClientGuide() {
  const { t } = useTranslations()

  return (
    <Card>
      <CardContent className="pt-6 text-sm space-y-2">
        <p className="font-medium theme-text-primary">
          {t('settingsPages.apiAccess.clientGuide.title')}
        </p>
        <p className="theme-text-muted">{t('settingsPages.apiAccess.clientGuide.dcrNote')}</p>
        <p className="theme-text-muted">{t('settingsPages.apiAccess.clientGuide.manualNote')}</p>
      </CardContent>
    </Card>
  )
}
