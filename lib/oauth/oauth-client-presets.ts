export const OAUTH_REDIRECT_PRESETS = {
  vscodeCopilot: [
    'http://127.0.0.1:33418',
    'https://vscode.dev/redirect',
  ],
} as const

export function mergeOAuthRedirectUris(currentValue: string, preset: readonly string[]): string {
  const currentUris = currentValue
    .split('\n')
    .map(uri => uri.trim())
    .filter(Boolean)

  return [...new Set([...currentUris, ...preset])].join('\n')
}
