/**
 * OpenClaw Signing — Ed25519 request signing for OpenClaw gateway connections
 *
 * Astrid.cc signs connection requests so that OpenClaw gateways can verify
 * the request originated from a trusted Astrid instance. Uses Ed25519 for
 * compact, fast signatures.
 *
 * Flow:
 *  1. Astrid.cc signs a connection request with its private key
 *  2. Gateway fetches Astrid's public key from /.well-known/openclaw-public-key
 *  3. Gateway verifies the signature before accepting the connection
 */

import { BRAND } from '@/lib/brand/config'
import crypto from 'crypto'

// Default max age for signature verification (5 minutes)
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000

// Clock skew tolerance for future timestamp rejection (60 seconds)
const FUTURE_TOLERANCE_MS = 60 * 1000

// ── Types ──────────────────────────────────────────────────────────────

export interface SigningKeyPair {
  privateKey: crypto.KeyObject
  publicKey: crypto.KeyObject
  keyId: string
}

export interface PublicKeyInfo {
  publicKey: string
  keyId: string
  algorithm: string
  issuer: string
  createdAt: string
}

export interface ConnectionPayload {
  gatewayUrl: string
  userId: string
  timestamp: string
  nonce: string
}

export interface SignedConnectionRequest {
  payload: ConnectionPayload
  signature: string
  keyId: string
}

export interface VerificationResult {
  valid: boolean
  error?: string
}

// ── Key Management ─────────────────────────────────────────────────────

/**
 * Load the signing keypair from the OPENCLAW_SIGNING_PRIVATE_KEY env var.
 * Derives the public key and keyId from the private key.
 */
export function getSigningKeyPair(): SigningKeyPair {
  const pem = process.env.OPENCLAW_SIGNING_PRIVATE_KEY
  if (!pem) {
    throw new Error('OPENCLAW_SIGNING_PRIVATE_KEY environment variable is required')
  }

  let privateKey: crypto.KeyObject
  try {
    privateKey = crypto.createPrivateKey(pem)
  } catch {
    throw new Error('Invalid OPENCLAW_SIGNING_PRIVATE_KEY: could not parse as Ed25519 private key')
  }

  const publicKey = crypto.createPublicKey(privateKey)
  const keyId = deriveKeyId(publicKey)

  return { privateKey, publicKey, keyId }
}

/**
 * Get public key info suitable for exposing at /.well-known/openclaw-public-key
 */
export function getPublicKeyInfo(): PublicKeyInfo {
  const { publicKey, keyId } = getSigningKeyPair()

  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    keyId,
    algorithm: 'Ed25519',
    issuer: `${BRAND.domain}`,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Derive a 16-hex-char keyId from the SHA-256 hash of the DER-encoded public key.
 */
function deriveKeyId(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16)
}

// ── Signing ────────────────────────────────────────────────────────────

/**
 * Sign a connection request for an OpenClaw gateway.
 */
export function signConnectionRequest(
  gatewayUrl: string,
  userId: string
): SignedConnectionRequest {
  const { privateKey, keyId } = getSigningKeyPair()

  const payload: ConnectionPayload = {
    gatewayUrl,
    userId,
    timestamp: new Date().toISOString(),
    nonce: crypto.randomBytes(16).toString('hex'),
  }

  const payloadString = JSON.stringify(payload)
  const signature = crypto.sign(null, Buffer.from(payloadString), privateKey)

  return {
    payload,
    signature: signature.toString('base64'),
    keyId,
  }
}

// ── Verification ───────────────────────────────────────────────────────

/**
 * Verify a signed connection request against a public key.
 *
 * @param signed  The signed request (payload + signature + keyId)
 * @param publicKeyPem  PEM-encoded Ed25519 public key
 * @param maxAgeMs  Maximum age of the signature in milliseconds (default 5 min)
 */
export function verifyConnectionSignature(
  signed: SignedConnectionRequest,
  publicKeyPem: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): VerificationResult {
  try {
    const { payload, signature } = signed

    // Check for future timestamps
    const signedAt = new Date(payload.timestamp).getTime()
    const now = Date.now()

    if (signedAt > now + FUTURE_TOLERANCE_MS) {
      return { valid: false, error: 'Timestamp is in the future' }
    }

    // Check for expired timestamps
    if (now - signedAt > maxAgeMs) {
      return { valid: false, error: 'Signature expired' }
    }

    // Verify the cryptographic signature
    const publicKey = crypto.createPublicKey(publicKeyPem)
    const payloadString = JSON.stringify(payload)
    const signatureBuffer = Buffer.from(signature, 'base64')

    const valid = crypto.verify(null, Buffer.from(payloadString), publicKey, signatureBuffer)

    if (!valid) {
      return { valid: false, error: 'Invalid signature' }
    }

    return { valid: true }
  } catch (err) {
    return {
      valid: false,
      error: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// ── Key Generation ─────────────────────────────────────────────────────

/**
 * Generate a new Ed25519 signing keypair.
 * Useful for initial setup — output the private key PEM to set as
 * OPENCLAW_SIGNING_PRIVATE_KEY env var.
 */
export function generateSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  }
}
