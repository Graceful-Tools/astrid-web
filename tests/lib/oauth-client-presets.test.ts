import { describe, expect, it } from 'vitest'
import {
  mergeOAuthRedirectUris,
  OAUTH_REDIRECT_PRESETS,
} from '@/lib/oauth/oauth-client-presets'

describe('OAuth client redirect presets', () => {
  it('task a0e0808c provides every documented VS Code Copilot OAuth callback', () => {
    expect(OAUTH_REDIRECT_PRESETS.vscodeCopilot).toEqual([
      'http://127.0.0.1:33418',
      'https://vscode.dev/redirect',
    ])
  })

  it('preserves custom callbacks while adding presets without duplicates', () => {
    expect(
      mergeOAuthRedirectUris(
        'https://example.com/callback\nhttp://127.0.0.1:33418',
        OAUTH_REDIRECT_PRESETS.vscodeCopilot
      )
    ).toBe(
      'https://example.com/callback\nhttp://127.0.0.1:33418\nhttps://vscode.dev/redirect'
    )
  })
})
