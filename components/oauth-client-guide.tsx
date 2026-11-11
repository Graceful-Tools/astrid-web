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
  /** i18n keys — a module constant cannot call `t`, so the component resolves them. */
  labelKey: string
  descriptionKey: string
}> = [
  {
    value: 'client_credentials',
    labelKey: 'settingsPages.apiAccess.grants.clientCredentials.label',
    descriptionKey: 'settingsPages.apiAccess.grants.clientCredentials.description',
  },
  {
    value: 'authorization_code',
    labelKey: 'settingsPages.apiAccess.grants.authorizationCode.label',
    descriptionKey: 'settingsPages.apiAccess.grants.authorizationCode.description',
  },
  {
    value: 'refresh_token',
    labelKey: 'settingsPages.apiAccess.grants.refreshToken.label',
    descriptionKey: 'settingsPages.apiAccess.grants.refreshToken.description',
  },
]

export function OAuthClientGuide() {
  const { t } = useTranslations()

  return (
    <Card>
      <CardContent className="pt-6 text-sm space-y-2">
        <p className="font-medium theme-text-primary">
          {t('settingsPages.apiAccess.clientGuide.question')}
        </p>
        <p className="theme-text-muted">{t('settingsPages.apiAccess.clientGuide.registersItself')}</p>
        <p className="theme-text-muted">{t('settingsPages.apiAccess.clientGuide.manualOnly')}</p>
      </CardContent>
    </Card>
  )
}
