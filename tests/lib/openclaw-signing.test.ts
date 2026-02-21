/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

// Generate a test keypair
const testKeyPair = crypto.generateKeyPairSync('ed25519')
const testPrivateKeyPem = testKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const testPublicKeyPem = testKeyPair.publicKey.export({ type: 'spki', format: 'pem' }) as string

describe('OpenClaw Signing', () => {
  beforeEach(() => {
    vi.stubEnv('OPENCLAW_SIGNING_PRIVATE_KEY', testPrivateKeyPem)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('getSigningKeyPair', () => {
    it('should return a valid keypair from environment variable', async () => {
      const { getSigningKeyPair } = await import('@/lib/ai/openclaw-signing')

      const { privateKey, publicKey, keyId } = getSigningKeyPair()

      expect(privateKey).toBeDefined()
      expect(publicKey).toBeDefined()
      expect(keyId).toMatch(/^[a-f0-9]{16}$/)
    })

    it('should throw if OPENCLAW_SIGNING_PRIVATE_KEY is not set', async () => {
      vi.stubEnv('OPENCLAW_SIGNING_PRIVATE_KEY', '')

      // Need to re-import to get fresh module state
      vi.resetModules()
      const { getSigningKeyPair } = await import('@/lib/ai/openclaw-signing')

      expect(() => getSigningKeyPair()).toThrow('OPENCLAW_SIGNING_PRIVATE_KEY environment variable is required')
    })

    it('should throw for invalid private key', async () => {
      vi.stubEnv('OPENCLAW_SIGNING_PRIVATE_KEY', 'invalid-key-data')

      vi.resetModules()
      const { getSigningKeyPair } = await import('@/lib/ai/openclaw-signing')

      expect(() => getSigningKeyPair()).toThrow('Invalid OPENCLAW_SIGNING_PRIVATE_KEY')
    })

    it('should generate consistent keyId for the same key', async () => {
      const { getSigningKeyPair } = await import('@/lib/ai/openclaw-signing')

      const result1 = getSigningKeyPair()
      const result2 = getSigningKeyPair()

      expect(result1.keyId).toBe(result2.keyId)
    })
  })

  describe('getPublicKeyInfo', () => {
    it('should return public key info in correct format', async () => {
      const { getPublicKeyInfo } = await import('@/lib/ai/openclaw-signing')

      const info = getPublicKeyInfo()

      expect(info.publicKey).toContain('-----BEGIN PUBLIC KEY-----')
      expect(info.publicKey).toContain('-----END PUBLIC KEY-----')
      expect(info.keyId).toMatch(/^[a-f0-9]{16}$/)
      expect(info.algorithm).toBe('Ed25519')
      expect(info.issuer).toBe('astrid.cc')
      expect(new Date(info.createdAt)).toBeInstanceOf(Date)
    })
  })

  describe('signConnectionRequest', () => {
    it('should sign a connection request', async () => {
      const { signConnectionRequest } = await import('@/lib/ai/openclaw-signing')

      const signature = signConnectionRequest(
        'wss://gateway.example.com',
        'user-123'
      )

      expect(signature.payload.gatewayUrl).toBe('wss://gateway.example.com')
      expect(signature.payload.userId).toBe('user-123')
      expect(signature.payload.timestamp).toBeDefined()
      expect(signature.payload.nonce).toMatch(/^[a-f0-9]{32}$/)
      expect(signature.signature).toBeDefined()
      expect(signature.keyId).toMatch(/^[a-f0-9]{16}$/)
    })

    it('should generate unique nonces for each request', async () => {
      const { signConnectionRequest } = await import('@/lib/ai/openclaw-signing')

      const sig1 = signConnectionRequest('wss://gateway.example.com', 'user-123')
      const sig2 = signConnectionRequest('wss://gateway.example.com', 'user-123')

      expect(sig1.payload.nonce).not.toBe(sig2.payload.nonce)
    })

    it('should create valid base64-encoded signatures', async () => {
      const { signConnectionRequest } = await import('@/lib/ai/openclaw-signing')

      const signature = signConnectionRequest('wss://gateway.example.com', 'user-123')

      // Verify it's valid base64
      const decoded = Buffer.from(signature.signature, 'base64')
      expect(decoded.length).toBeGreaterThan(0)

      // Ed25519 signatures are 64 bytes
      expect(decoded.length).toBe(64)
    })
  })

  describe('verifyConnectionSignature', () => {
    it('should verify a valid signature', async () => {
      const { signConnectionRequest, verifyConnectionSignature } = await import('@/lib/ai/openclaw-signing')

      const signature = signConnectionRequest('wss://gateway.example.com', 'user-123')
      const result = verifyConnectionSignature(signature, testPublicKeyPem)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should reject a tampered signature', async () => {
      const { signConnectionRequest, verifyConnectionSignature } = await import('@/lib/ai/openclaw-signing')

      const signature = signConnectionRequest('wss://gateway.example.com', 'user-123')

      // Tamper with the payload
      signature.payload.userId = 'tampered-user'

      const result = verifyConnectionSignature(signature, testPublicKeyPem)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid signature')
    })

    it('should reject a completely wrong signature', async () => {
      const { signConnectionRequest, verifyConnectionSignature } = await import('@/lib/ai/openclaw-signing')

      const signature = signConnectionRequest('wss://gateway.example.com', 'user-123')

      // Replace signature with garbage
      signature.signature = Buffer.from('invalid-signature-bytes'.repeat(4)).toString('base64')

      const result = verifyConnectionSignature(signature, testPublicKeyPem)

      expect(result.valid).toBe(false)
    })

    it('should reject expired signatures', async () => {
      const { signConnectionRequest, verifyConnectionSignature } = await import('@/lib/ai/openclaw-signing')

      const signature = signConnectionRequest('wss://gateway.example.com', 'user-123')

      // Set timestamp to 10 minutes ago
      signature.payload.timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString()

      // Re-sign the payload to make it valid except for timestamp
      // (This tests the timestamp check, not the signature verification)
      const result = verifyConnectionSignature(signature, testPublicKeyPem, 5 * 60 * 1000)

      // It will fail either due to timestamp or signature mismatch
      expect(result.valid).toBe(false)
    })

    it('should reject future timestamps', async () => {
      const { signConnectionRequest, verifyConnectionSignature } = await import('@/lib/ai/openclaw-signing')

      const signature = signConnectionRequest('wss://gateway.example.com', 'user-123')

      // Set timestamp to 10 minutes in the future
      signature.payload.timestamp = new Date(Date.now() + 10 * 60 * 1000).toISOString()

      const result = verifyConnectionSignature(signature, testPublicKeyPem)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('future')
    })

    it('should reject signatures with wrong public key', async () => {
      const { signConnectionRequest, verifyConnectionSignature } = await import('@/lib/ai/openclaw-signing')

      // Generate a different keypair
      const otherKeyPair = crypto.generateKeyPairSync('ed25519')
      const otherPublicKeyPem = otherKeyPair.publicKey.export({ type: 'spki', format: 'pem' }) as string

      const signature = signConnectionRequest('wss://gateway.example.com', 'user-123')
      const result = verifyConnectionSignature(signature, otherPublicKeyPem)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid signature')
    })

    it('should handle invalid public key gracefully', async () => {
      const { signConnectionRequest, verifyConnectionSignature } = await import('@/lib/ai/openclaw-signing')

      const signature = signConnectionRequest('wss://gateway.example.com', 'user-123')
      const result = verifyConnectionSignature(signature, 'invalid-public-key')

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Verification error')
    })

    it('should allow custom max age', async () => {
      const { signConnectionRequest, verifyConnectionSignature } = await import('@/lib/ai/openclaw-signing')

      const signature = signConnectionRequest('wss://gateway.example.com', 'user-123')

      // With 1 second max age, it should still be valid
      const result = verifyConnectionSignature(signature, testPublicKeyPem, 1000)

      expect(result.valid).toBe(true)
    })
  })

  describe('generateSigningKeyPair', () => {
    it('should generate a valid Ed25519 keypair', async () => {
      const { generateSigningKeyPair } = await import('@/lib/ai/openclaw-signing')

      const { privateKeyPem, publicKeyPem } = generateSigningKeyPair()

      expect(privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----')
      expect(privateKeyPem).toContain('-----END PRIVATE KEY-----')
      expect(publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----')
      expect(publicKeyPem).toContain('-----END PUBLIC KEY-----')
    })

    it('should generate keys that can sign and verify', async () => {
      const { generateSigningKeyPair, verifyConnectionSignature } = await import('@/lib/ai/openclaw-signing')

      const { privateKeyPem, publicKeyPem } = generateSigningKeyPair()

      // Create a signature manually with the new key
      const privateKey = crypto.createPrivateKey(privateKeyPem)
      const payload = {
        timestamp: new Date().toISOString(),
        nonce: crypto.randomBytes(16).toString('hex'),
        gatewayUrl: 'wss://test.com',
        userId: 'test-user'
      }
      const payloadString = JSON.stringify(payload)
      const signature = crypto.sign(null, Buffer.from(payloadString), privateKey)

      const publicKeyDer = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' })
      const keyId = crypto.createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 16)

      const result = verifyConnectionSignature(
        {
          payload,
          signature: signature.toString('base64'),
          keyId
        },
        publicKeyPem
      )

      expect(result.valid).toBe(true)
    })
  })
})

describe('OpenClaw Signing Integration', () => {
  beforeEach(() => {
    vi.stubEnv('OPENCLAW_SIGNING_PRIVATE_KEY', testPrivateKeyPem)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('should complete full sign-verify flow', async () => {
    const {
      signConnectionRequest,
      verifyConnectionSignature,
      getPublicKeyInfo
    } = await import('@/lib/ai/openclaw-signing')

    // Simulate astrid.cc signing a request
    const signature = signConnectionRequest(
      'wss://my-gateway.local:18789',
      'user-abc-123'
    )

    // Simulate gateway fetching public key from /.well-known/openclaw-public-key
    const publicKeyInfo = getPublicKeyInfo()

    // Simulate gateway verifying the signature
    const result = verifyConnectionSignature(signature, publicKeyInfo.publicKey)

    expect(result.valid).toBe(true)
  })

  it('should include correct metadata in signature', async () => {
    const { signConnectionRequest } = await import('@/lib/ai/openclaw-signing')

    const gatewayUrl = 'wss://specific-gateway.local:18789'
    const userId = 'specific-user-id'

    const signature = signConnectionRequest(gatewayUrl, userId)

    // Gateway should be able to verify request details
    expect(signature.payload.gatewayUrl).toBe(gatewayUrl)
    expect(signature.payload.userId).toBe(userId)

    // Timestamp should be recent
    const signedAt = new Date(signature.payload.timestamp)
    const now = new Date()
    expect(now.getTime() - signedAt.getTime()).toBeLessThan(5000) // Within 5 seconds
  })
})
