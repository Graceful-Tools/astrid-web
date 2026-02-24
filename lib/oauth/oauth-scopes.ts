/**
 * OAuth Scopes for Astrid API
 *
 * Defines all available OAuth scopes and scope groups for common use cases.
 * Scopes control what operations a client can perform via the API.
 */

export const OAUTH_SCOPES = {
  // Task scopes
  'tasks:read': 'Read tasks',
  'tasks:write': 'Create and update tasks',
  'tasks:delete': 'Delete tasks',

  // List scopes
  'lists:read': 'Read lists',
  'lists:write': 'Create and update lists',
  'lists:delete': 'Delete lists',
  'lists:manage_members': 'Manage list members',

  // Comment scopes
  'comments:read': 'Read comments',
  'comments:write': 'Create comments',
  'comments:delete': 'Delete comments',

  // User scopes
  'user:read': 'Read user profile and settings',
  'user:write': 'Update user settings',

  // Attachment scopes
  'attachments:read': 'Read attachments',
  'attachments:write': 'Upload attachments',
  'attachments:delete': 'Delete attachments',

  // Contacts scopes (address book)
  'contacts:read': 'Read uploaded contacts',
  'contacts:write': 'Upload and manage contacts',

  // Public list scopes
  'public:read': 'Read public lists',
  'public:write': 'Create and manage public lists',

  // SSE scopes
  'sse:connect': 'Connect to SSE event stream',

  // Special scopes
  '*': 'Full access (internal use only - granted to session-based auth)',
} as const

export type OAuthScope = keyof typeof OAUTH_SCOPES

/**
 * Predefined scope groups for common client types
 */
export const SCOPE_GROUPS = {
  /**
   * Full access for mobile apps (iOS, Android)
   * Includes all task, list, comment, and user operations
   */
  mobile_app: [
    'tasks:read',
    'tasks:write',
    'tasks:delete',
    'lists:read',
    'lists:write',
    'lists:delete',
    'lists:manage_members',
    'comments:read',
    'comments:write',
    'comments:delete',
    'attachments:read',
    'attachments:write',
    'attachments:delete',
    'contacts:read',
    'contacts:write',
    'user:read',
    'user:write',
    'public:read',
    'public:write',
  ] as OAuthScope[],

  /**
   * Read-only access for monitoring and analytics tools
   */
  readonly: [
    'tasks:read',
    'lists:read',
    'comments:read',
    'attachments:read',
    'user:read',
    'public:read',
  ] as OAuthScope[],

  /**
   * AI agents need task and comment access for automation
   */
  ai_agent: [
    'tasks:read',
    'tasks:write',
    'lists:read',
    'comments:read',
    'comments:write',
    'user:read',
    'sse:connect',
  ] as OAuthScope[],

  /**
   * Task-only access for simple integrations
   */
  tasks_only: [
    'tasks:read',
    'tasks:write',
    'tasks:delete',
  ] as OAuthScope[],

  /**
   * Public list browser (read-only public content)
   */
  public_readonly: [
    'public:read',
  ] as OAuthScope[],
} as const

export type ScopeGroup = keyof typeof SCOPE_GROUPS

/**
 * Check if a scope string is valid
 */
export function isValidScope(scope: string): scope is OAuthScope {
  return scope in OAUTH_SCOPES
}

/**
 * Validate an array of scopes
 * @returns Array of valid scopes, filtering out invalid ones
 */
export function validateScopes(scopes: string[]): OAuthScope[] {
  return scopes.filter(isValidScope)
}

/**
 * Check if requested scopes are satisfied by granted scopes
 * Handles wildcard scope ('*') which grants all permissions
 */
export function hasRequiredScopes(
  grantedScopes: string[],
  requiredScopes: string[]
): boolean {
  // Wildcard grants everything
  if (grantedScopes.includes('*')) {
    return true
  }

  // Check if all required scopes are granted
  return requiredScopes.every(scope => grantedScopes.includes(scope))
}

/**
 * Get scope group by name
 */
export function getScopeGroup(group: ScopeGroup): OAuthScope[] {
  return SCOPE_GROUPS[group]
}

/**
 * Get human-readable description for a scope
 */
export function getScopeDescription(scope: string): string {
  if (isValidScope(scope)) {
    return OAUTH_SCOPES[scope]
  }
  return 'Unknown scope'
}

/**
 * Parse scope string from OAuth request (space-separated)
 */
export function parseScopeString(scopeString: string): OAuthScope[] {
  const scopes = scopeString.split(' ').map(s => s.trim()).filter(Boolean)
  return validateScopes(scopes)
}

/**
 * Format scopes array as OAuth scope string (space-separated)
 */
export function formatScopeString(scopes: string[]): string {
  return scopes.join(' ')
}

/**
 * Get all available scopes (excluding wildcard)
 */
export function getAllScopes(): OAuthScope[] {
  return Object.keys(OAUTH_SCOPES).filter(s => s !== '*') as OAuthScope[]
}
