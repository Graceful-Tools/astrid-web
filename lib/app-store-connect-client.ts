/**
 * App Store Connect API Client
 *
 * Provides access to Xcode Cloud builds and TestFlight information.
 *
 * Setup:
 * 1. Go to App Store Connect → Users and Access → Keys
 * 2. Create a new API Key with "Developer" or "Admin" role
 * 3. Download the .p8 file (only available once!)
 * 4. Note the Key ID and Issuer ID
 * 5. Add to .env.local:
 *    ASC_KEY_ID=your-key-id
 *    ASC_ISSUER_ID=your-issuer-id
 *    ASC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
 *    ASC_APP_ID=your-app-id (from App Store Connect URL)
 *
 * @see https://developer.apple.com/documentation/appstoreconnectapi
 */

import * as crypto from 'crypto'
import { createLogger } from '@/lib/logger'

const log = createLogger('app-store-connect-client')


// =============================================================================
// Types
// =============================================================================

export interface ASCBuild {
  id: string
  version: string
  buildNumber: string
  uploadedDate: string
  processingState: 'PROCESSING' | 'FAILED' | 'INVALID' | 'VALID'
  usesNonExemptEncryption: boolean | null
  minOsVersion: string
  iconAssetToken?: {
    templateUrl: string
    width: number
    height: number
  }
}

export interface ASCBetaBuild {
  id: string
  buildId: string
  version: string
  buildNumber: string
  betaReviewState: 'WAITING_FOR_BETA_REVIEW' | 'IN_BETA_REVIEW' | 'REJECTED' | 'APPROVED'
  externalBuildState: 'PROCESSING' | 'PROCESSING_EXCEPTION' | 'MISSING_EXPORT_COMPLIANCE' | 'READY_FOR_BETA_TESTING' | 'IN_BETA_TESTING' | 'EXPIRED' | 'IN_EXPORT_COMPLIANCE_REVIEW'
  internalBuildState: 'PROCESSING' | 'PROCESSING_EXCEPTION' | 'MISSING_EXPORT_COMPLIANCE' | 'READY_FOR_BETA_TESTING' | 'IN_BETA_TESTING' | 'EXPIRED' | 'IN_EXPORT_COMPLIANCE_REVIEW'
}

export interface ASCCiBuildRun {
  id: string
  number: number
  createdDate: string
  startedDate: string | null
  finishedDate: string | null
  sourceCommit: {
    commitSha: string
    message: string
    author: string
  }
  executionProgress: 'PENDING' | 'RUNNING' | 'COMPLETE'
  completionStatus: 'SUCCEEDED' | 'FAILED' | 'ERRORED' | 'CANCELED' | null
}

export interface ASCCiWorkflow {
  id: string
  name: string
  description: string
  branchStartCondition?: {
    source: {
      isAllMatch: boolean
      patterns: Array<{ pattern: string; isPrefix: boolean }>
    }
  }
  isEnabled: boolean
  isLockedForEditing: boolean
  lastModifiedDate: string
}

export interface TestFlightPublicLink {
  id: string
  publicLink: string
  publicLinkLimit: number
  publicLinkLimitEnabled: boolean
  publicLinkStatus: 'ENABLED' | 'DISABLED'
}

// =============================================================================
// JWT Token Generation
// =============================================================================

function base64UrlEncode(data: Buffer): string {
  return data.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function generateJWT(keyId: string, issuerId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const expiry = now + 20 * 60 // 20 minutes

  const header = {
    alg: 'ES256',
    kid: keyId,
    typ: 'JWT'
  }

  const payload = {
    iss: issuerId,
    iat: now,
    exp: expiry,
    aud: 'appstoreconnect-v1'
  }

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)))
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`

  // Sign with ES256 (ECDSA with P-256 and SHA-256)
  const sign = crypto.createSign('SHA256')
  sign.update(signingInput)
  const signature = sign.sign(privateKey)

  // Convert DER signature to raw r||s format for JWT
  const signatureB64 = base64UrlEncode(derToRaw(signature))

  return `${signingInput}.${signatureB64}`
}

// Convert DER-encoded ECDSA signature to raw r||s format
function derToRaw(derSignature: Buffer): Buffer {
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  let offset = 2 // Skip 0x30 and total length

  // Read r
  if (derSignature[offset] !== 0x02) throw new Error('Invalid DER signature')
  offset++
  const rLength = derSignature[offset]
  offset++
  let r = derSignature.subarray(offset, offset + rLength)
  offset += rLength

  // Read s
  if (derSignature[offset] !== 0x02) throw new Error('Invalid DER signature')
  offset++
  const sLength = derSignature[offset]
  offset++
  let s = derSignature.subarray(offset, offset + sLength)

  // Remove leading zeros and pad to 32 bytes
  if (r.length > 32) r = r.subarray(r.length - 32)
  if (s.length > 32) s = s.subarray(s.length - 32)

  const raw = Buffer.alloc(64)
  r.copy(raw, 32 - r.length)
  s.copy(raw, 64 - s.length)

  return raw
}

// =============================================================================
// App Store Connect Client
// =============================================================================

export class AppStoreConnectClient {
  private keyId: string
  private issuerId: string
  private privateKey: string
  private appId: string
  private baseUrl = 'https://api.appstoreconnect.apple.com/v1'
  private token: string | null = null
  private tokenExpiry: number = 0

  constructor() {
    this.keyId = process.env.ASC_KEY_ID || ''
    this.issuerId = process.env.ASC_ISSUER_ID || ''
    this.privateKey = (process.env.ASC_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    this.appId = process.env.ASC_APP_ID || ''

    if (!this.keyId || !this.issuerId || !this.privateKey) {
      throw new Error(
        'App Store Connect API not configured. Set ASC_KEY_ID, ASC_ISSUER_ID, and ASC_PRIVATE_KEY in .env.local'
      )
    }
  }

  /**
   * Check if App Store Connect is configured
   */
  static isConfigured(): boolean {
    return !!(
      process.env.ASC_KEY_ID &&
      process.env.ASC_ISSUER_ID &&
      process.env.ASC_PRIVATE_KEY
    )
  }

  /**
   * Get or refresh JWT token
   */
  private getToken(): string {
    const now = Date.now()
    if (!this.token || now >= this.tokenExpiry) {
      this.token = generateJWT(this.keyId, this.issuerId, this.privateKey)
      this.tokenExpiry = now + 15 * 60 * 1000 // Refresh 5 min before expiry
    }
    return this.token
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.getToken()}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`App Store Connect API error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  // ===========================================================================
  // Xcode Cloud APIs
  // ===========================================================================

  /**
   * List Xcode Cloud workflows for the app
   */
  async listCiWorkflows(): Promise<ASCCiWorkflow[]> {
    if (!this.appId) {
      throw new Error('ASC_APP_ID not configured')
    }

    const response = await this.request<{
      data: Array<{
        id: string
        attributes: Omit<ASCCiWorkflow, 'id'>
      }>
    }>(`/ciProducts/${this.appId}/workflows`)

    return response.data.map(w => ({
      id: w.id,
      ...w.attributes,
    }))
  }

  /**
   * Get recent Xcode Cloud build runs
   */
  async listCiBuildRuns(workflowId?: string, limit = 10): Promise<ASCCiBuildRun[]> {
    const path = workflowId
      ? `/ciWorkflows/${workflowId}/buildRuns?limit=${limit}`
      : `/ciBuildRuns?limit=${limit}`

    const response = await this.request<{
      data: Array<{
        id: string
        attributes: {
          number: number
          createdDate: string
          startedDate: string | null
          finishedDate: string | null
          sourceCommit: {
            commitSha: string
            message: string
            author: string
          }
          executionProgress: ASCCiBuildRun['executionProgress']
          completionStatus: ASCCiBuildRun['completionStatus']
        }
      }>
    }>(path)

    return response.data.map(r => ({
      id: r.id,
      ...r.attributes,
    }))
  }

  /**
   * Get a specific Xcode Cloud build run
   */
  async getCiBuildRun(buildRunId: string): Promise<ASCCiBuildRun> {
    const response = await this.request<{
      data: {
        id: string
        attributes: Omit<ASCCiBuildRun, 'id'>
      }
    }>(`/ciBuildRuns/${buildRunId}`)

    return {
      id: response.data.id,
      ...response.data.attributes,
    }
  }

  /**
   * Wait for Xcode Cloud build to complete
   */
  async waitForCiBuild(
    buildRunId: string,
    timeoutMs = 900000 // 15 minutes
  ): Promise<ASCCiBuildRun> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const buildRun = await this.getCiBuildRun(buildRunId)

      if (buildRun.executionProgress === 'COMPLETE') {
        return buildRun
      }

      // Wait 30 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 30000))
    }

    throw new Error('Timeout waiting for Xcode Cloud build')
  }

  /**
   * Find the most recent Xcode Cloud build for a commit
   */
  async findBuildRunByCommit(commitSha: string): Promise<ASCCiBuildRun | null> {
    const buildRuns = await this.listCiBuildRuns(undefined, 20)

    return buildRuns.find(r =>
      r.sourceCommit.commitSha.startsWith(commitSha) ||
      commitSha.startsWith(r.sourceCommit.commitSha)
    ) || null
  }

  // ===========================================================================
  // TestFlight APIs
  // ===========================================================================

  /**
   * List recent builds for the app
   */
  async listBuilds(limit = 10): Promise<ASCBuild[]> {
    if (!this.appId) {
      throw new Error('ASC_APP_ID not configured')
    }

    const response = await this.request<{
      data: Array<{
        id: string
        attributes: Omit<ASCBuild, 'id'>
      }>
    }>(`/builds?filter[app]=${this.appId}&limit=${limit}&sort=-uploadedDate`)

    return response.data.map(b => ({
      id: b.id,
      ...b.attributes,
    }))
  }

  /**
   * Get the latest TestFlight build
   */
  async getLatestTestFlightBuild(): Promise<ASCBuild | null> {
    const builds = await this.listBuilds(5)

    // Find the most recent valid build
    return builds.find(b => b.processingState === 'VALID') || null
  }

  /**
   * Get TestFlight public link info for the app
   */
  async getTestFlightPublicLink(): Promise<TestFlightPublicLink | null> {
    if (!this.appId) {
      throw new Error('ASC_APP_ID not configured')
    }

    try {
      // Get beta groups with public links
      const response = await this.request<{
        data: Array<{
          id: string
          attributes: {
            name: string
            publicLink: string | null
            publicLinkEnabled: boolean
            publicLinkLimit: number
            publicLinkLimitEnabled: boolean
          }
        }>
      }>(`/apps/${this.appId}/betaGroups?filter[isInternalGroup]=false`)

      // Find a group with a public link
      const groupWithLink = response.data.find(g => g.attributes.publicLink)

      if (!groupWithLink) {
        return null
      }

      return {
        id: groupWithLink.id,
        publicLink: groupWithLink.attributes.publicLink!,
        publicLinkLimit: groupWithLink.attributes.publicLinkLimit,
        publicLinkLimitEnabled: groupWithLink.attributes.publicLinkLimitEnabled,
        publicLinkStatus: groupWithLink.attributes.publicLinkEnabled ? 'ENABLED' : 'DISABLED',
      }
    } catch (error) {
      log.error({ err: error }, 'Error fetching TestFlight public link:')
      return null
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Get build status summary for posting to task comments
   */
  async getBuildStatusForComment(): Promise<{
    latestBuild: ASCBuild | null
    publicLink: string | null
    xcodeCloudStatus: ASCCiBuildRun | null
  }> {
    const [latestBuild, publicLinkInfo, buildRuns] = await Promise.all([
      this.getLatestTestFlightBuild().catch(() => null),
      this.getTestFlightPublicLink().catch(() => null),
      this.listCiBuildRuns(undefined, 1).catch(() => []),
    ])

    return {
      latestBuild,
      publicLink: publicLinkInfo?.publicLink || process.env.TESTFLIGHT_PUBLIC_LINK || null,
      xcodeCloudStatus: buildRuns[0] || null,
    }
  }

  /**
   * Format build info for task comment
   */
  formatBuildComment(status: {
    latestBuild: ASCBuild | null
    publicLink: string | null
    xcodeCloudStatus: ASCCiBuildRun | null
  }): string {
    let comment = '📱 **iOS Build Status**\n\n'

    if (status.xcodeCloudStatus) {
      const xc = status.xcodeCloudStatus
      const statusEmoji = xc.executionProgress === 'COMPLETE'
        ? (xc.completionStatus === 'SUCCEEDED' ? '✅' : '❌')
        : '🔄'

      comment += `**Xcode Cloud:** ${statusEmoji} Build #${xc.number}\n`
      comment += `- Status: ${xc.executionProgress}${xc.completionStatus ? ` (${xc.completionStatus})` : ''}\n`
      comment += `- Commit: \`${xc.sourceCommit.commitSha.substring(0, 7)}\`\n`

      if (xc.finishedDate) {
        comment += `- Finished: ${new Date(xc.finishedDate).toLocaleString()}\n`
      }
      comment += '\n'
    }

    if (status.latestBuild) {
      comment += `**Latest TestFlight Build:** v${status.latestBuild.version} (${status.latestBuild.buildNumber})\n`
      comment += `- Uploaded: ${new Date(status.latestBuild.uploadedDate).toLocaleString()}\n\n`
    }

    if (status.publicLink) {
      comment += `🍎 **TestFlight:** [Get the latest build](${status.publicLink})\n`
    }

    return comment
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Get iOS build info for a task comment (handles unconfigured state gracefully)
 */
export async function getIOSBuildInfo(): Promise<{
  available: boolean
  comment: string
  publicLink: string | null
}> {
  // Check for static link first (simpler setup)
  const staticLink = process.env.TESTFLIGHT_PUBLIC_LINK

  if (!AppStoreConnectClient.isConfigured()) {
    if (staticLink) {
      return {
        available: true,
        comment: `📱 **iOS:** Xcode Cloud build triggered\n\n🍎 **TestFlight:** [Get the latest build](${staticLink})\n*(Build available in ~10-15 min)*`,
        publicLink: staticLink,
      }
    }

    return {
      available: false,
      comment: '📱 **iOS:** Xcode Cloud build triggered\n\n💡 *Set TESTFLIGHT_PUBLIC_LINK or configure App Store Connect API for build links*',
      publicLink: null,
    }
  }

  try {
    const client = new AppStoreConnectClient()
    const status = await client.getBuildStatusForComment()

    return {
      available: true,
      comment: client.formatBuildComment(status),
      publicLink: status.publicLink,
    }
  } catch (error) {
    log.error({ err: error }, 'Error getting iOS build info:')

    // Fall back to static link
    if (staticLink) {
      return {
        available: true,
        comment: `📱 **iOS:** Xcode Cloud build triggered\n\n🍎 **TestFlight:** [Get the latest build](${staticLink})`,
        publicLink: staticLink,
      }
    }

    return {
      available: false,
      comment: `📱 **iOS:** Xcode Cloud build triggered\n\n⚠️ Could not fetch build status`,
      publicLink: null,
    }
  }
}
