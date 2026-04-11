# OpenClaw Gateway Development Guide

This guide explains how to build an OpenClaw Gateway that connects with Astrid using the `astrid-signed` authentication mode.

## Overview

OpenClaw is a self-hosted AI agent worker that executes tasks using Claude Code CLI. The architecture:

```
┌─────────────────────────────────────────────────────────┐
│                    Your Server                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │  OpenClaw Gateway (WebSocket Server)            │    │
│  │  wss://your-gateway.example.com                 │    │
│  │  - Listens for connections from Astrid          │    │
│  │  - Verifies astrid-signed authentication        │    │
│  │  - Executes Claude Code tasks                   │    │
│  │  - Streams progress back to Astrid              │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                          ↑
                          │ Astrid connects with signed request
                          │
┌─────────────────────────────────────────────────────────┐
│                    astrid.cc                             │
│  - User registers gateway URL in settings               │
│  - Signs all connection requests with private key       │
│  - Public key available at /.well-known/openclaw-public-key
└─────────────────────────────────────────────────────────┘
```

## Authentication Modes

Astrid supports multiple authentication modes for OpenClaw connections:

| Mode | Description | Security Level |
|------|-------------|----------------|
| `astrid-signed` | Cryptographic signature verification (recommended) | Highest |
| `token` | Shared secret token | Good |
| `tailscale` | Tailscale identity verification | Excellent |
| `none` | No authentication (not recommended) | None |

## The `astrid-signed` Protocol

### How It Works

1. **Astrid signs the connection request** with its Ed25519 private key
2. **Your gateway fetches Astrid's public key** from `https://astrid.cc/.well-known/openclaw-public-key`
3. **Your gateway verifies the signature** - if valid, the request definitely came from astrid.cc
4. **Connection proceeds** if signature is valid and timestamp is fresh

### Connection Handshake

When Astrid connects to your gateway:

1. WebSocket connection opens
2. Your gateway sends a challenge event:
   ```json
   { "type": "event", "event": "connect.challenge" }
   ```

3. Astrid responds with a signed connect request:
   ```json
   {
     "type": "req",
     "id": "1234",
     "method": "connect",
     "params": {
       "minProtocol": 3,
       "maxProtocol": 3,
       "client": {
         "id": "astrid",
         "version": "1.0",
         "platform": "server",
         "mode": "webchat"
       },
       "auth": {
         "mode": "astrid-signed",
         "signature": {
           "payload": {
             "timestamp": "2024-01-15T10:30:00.000Z",
             "nonce": "a1b2c3d4e5f6...",
             "gatewayUrl": "wss://your-gateway.example.com",
             "userId": "user_abc123"
           },
           "signature": "base64-encoded-ed25519-signature",
           "keyId": "abc123def456"
         }
       }
     }
   }
   ```

4. Your gateway verifies the signature and responds:
   ```json
   { "type": "res", "id": "1234", "ok": true }
   ```

### Signature Verification

```typescript
import crypto from 'crypto'

interface SignedConnectionRequest {
  timestamp: string
  nonce: string
  gatewayUrl: string
  userId: string
}

interface ConnectionSignature {
  payload: SignedConnectionRequest
  signature: string  // base64
  keyId: string
}

// Cache the public key (refresh hourly)
let cachedPublicKey: string | null = null
let cacheExpiry = 0

async function getAstridPublicKey(): Promise<string> {
  if (cachedPublicKey && Date.now() < cacheExpiry) {
    return cachedPublicKey
  }

  const response = await fetch('https://astrid.cc/.well-known/openclaw-public-key')
  const data = await response.json()

  cachedPublicKey = data.publicKey
  cacheExpiry = Date.now() + 3600000  // 1 hour

  return cachedPublicKey
}

async function verifyAstridSignature(
  auth: { mode: string; signature?: ConnectionSignature },
  expectedGatewayUrl: string
): Promise<{ valid: boolean; userId?: string; error?: string }> {

  if (auth.mode !== 'astrid-signed' || !auth.signature) {
    return { valid: false, error: 'Not astrid-signed mode' }
  }

  const { payload, signature } = auth.signature

  // 1. Check timestamp (max 5 minutes old)
  const signedAt = new Date(payload.timestamp).getTime()
  const ageMs = Date.now() - signedAt

  if (ageMs < 0) {
    return { valid: false, error: 'Timestamp in future' }
  }
  if (ageMs > 5 * 60 * 1000) {
    return { valid: false, error: 'Signature expired' }
  }

  // 2. Check gateway URL matches
  if (payload.gatewayUrl !== expectedGatewayUrl) {
    return { valid: false, error: 'Gateway URL mismatch' }
  }

  // 3. Verify cryptographic signature
  try {
    const publicKeyPem = await getAstridPublicKey()
    const publicKey = crypto.createPublicKey(publicKeyPem)
    const payloadString = JSON.stringify(payload)
    const signatureBuffer = Buffer.from(signature, 'base64')

    const isValid = crypto.verify(
      null,  // Ed25519 doesn't use a digest
      Buffer.from(payloadString),
      publicKey,
      signatureBuffer
    )

    if (!isValid) {
      return { valid: false, error: 'Invalid signature' }
    }

    return { valid: true, userId: payload.userId }
  } catch (error) {
    return { valid: false, error: `Verification failed: ${error}` }
  }
}
```

## Minimal Gateway Implementation

Here's a minimal OpenClaw Gateway using Node.js and the `ws` package:

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import crypto from 'crypto'

const PORT = process.env.PORT || 3000
const GATEWAY_URL = process.env.GATEWAY_URL || `wss://localhost:${PORT}`

// Public key cache
let astridPublicKey: string | null = null

async function fetchAstridPublicKey(): Promise<string> {
  if (astridPublicKey) return astridPublicKey

  const res = await fetch('https://astrid.cc/.well-known/openclaw-public-key')
  const data = await res.json()
  astridPublicKey = data.publicKey

  // Refresh every hour
  setTimeout(() => { astridPublicKey = null }, 3600000)

  return astridPublicKey
}

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', async (ws: WebSocket) => {
  console.log('New connection')

  // Send challenge
  ws.send(JSON.stringify({ type: 'event', event: 'connect.challenge' }))

  let authenticated = false
  let userId: string | null = null

  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString())

    // Handle connect request
    if (msg.type === 'req' && msg.method === 'connect') {
      const auth = msg.params?.auth

      if (auth?.mode === 'astrid-signed' && auth.signature) {
        const result = await verifySignature(auth.signature)

        if (result.valid) {
          authenticated = true
          userId = result.userId
          ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true }))
          console.log(`Authenticated user: ${userId}`)
        } else {
          ws.send(JSON.stringify({
            type: 'res',
            id: msg.id,
            ok: false,
            error: { code: 'AUTH_FAILED', message: result.error }
          }))
          ws.close()
        }
      } else if (auth?.mode === 'token' && auth.token) {
        // Fallback to token auth if configured
        if (auth.token === process.env.AUTH_TOKEN) {
          authenticated = true
          ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true }))
        } else {
          ws.send(JSON.stringify({
            type: 'res',
            id: msg.id,
            ok: false,
            error: { code: 'AUTH_FAILED', message: 'Invalid token' }
          }))
          ws.close()
        }
      }
      return
    }

    // Require authentication for all other requests
    if (!authenticated) {
      ws.send(JSON.stringify({
        type: 'res',
        id: msg.id,
        ok: false,
        error: { code: 'NOT_AUTHENTICATED', message: 'Must authenticate first' }
      }))
      return
    }

    // Handle task requests
    if (msg.type === 'req' && msg.method === 'sessions_send') {
      // Execute the task with Claude Code
      // ... implementation here ...
    }
  })
})

async function verifySignature(sig: any): Promise<{ valid: boolean; userId?: string; error?: string }> {
  try {
    const { payload, signature } = sig

    // Check timestamp
    const age = Date.now() - new Date(payload.timestamp).getTime()
    if (age < 0 || age > 300000) {
      return { valid: false, error: 'Invalid timestamp' }
    }

    // Verify signature
    const publicKey = crypto.createPublicKey(await fetchAstridPublicKey())
    const isValid = crypto.verify(
      null,
      Buffer.from(JSON.stringify(payload)),
      publicKey,
      Buffer.from(signature, 'base64')
    )

    return isValid
      ? { valid: true, userId: payload.userId }
      : { valid: false, error: 'Invalid signature' }
  } catch (e) {
    return { valid: false, error: String(e) }
  }
}

console.log(`OpenClaw Gateway listening on port ${PORT}`)
```

## Exposing Your Gateway

### Option 1: Tailscale Funnel (Recommended for Personal Use)

```bash
# Install Tailscale, then:
tailscale funnel 3000

# Your gateway is now at wss://your-machine.tail-scale.ts.net
```

### Option 2: Cloudflare Tunnel

```bash
# Install cloudflared, then:
cloudflared tunnel --url http://localhost:3000

# Follow prompts to set up a permanent tunnel
```

### Option 3: Fly.io Deployment

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "gateway.js"]
```

```bash
fly launch
fly deploy
```

### Option 4: Direct Hosting

If you have a server with a public IP and SSL certificate:

```bash
# Use a reverse proxy like nginx or caddy for SSL termination
# Then point wss://your-domain.com to your gateway
```

## Registering Your Gateway in Astrid

1. Go to **Settings** → **OpenClaw Workers**
2. Click **Add Worker**
3. Enter:
   - **Name**: A friendly name for your gateway
   - **Gateway URL**: `wss://your-gateway.example.com`
   - **Auth Mode**: `astrid-signed` (recommended)
4. Click **Save**

Astrid will test the connection. If successful, your gateway is ready to receive tasks.

## RPC Methods

Your gateway should implement these methods:

| Method | Description |
|--------|-------------|
| `connect` | Authentication handshake |
| `ping` | Health check |
| `status` | Gateway status (version, active sessions, uptime) |
| `sessions_send` | Start a new task session |
| `sessions_list` | List active sessions |
| `sessions_history` | Get session transcript |
| `sessions_stop` | Stop a running session |
| `sessions_resume` | Resume a session with new input |

## Security Considerations

1. **Always verify signatures** - Never skip verification in production
2. **Cache the public key** - But refresh it periodically (hourly)
3. **Check timestamps** - Reject requests older than 5 minutes
4. **Verify gateway URL** - Ensure the signed URL matches your gateway
5. **Use TLS** - Always use `wss://` in production
6. **Rate limit** - Protect against connection floods

## Testing

To test your gateway locally:

```bash
# 1. Generate test keys
npm run generate:openclaw-keys

# 2. Add to .env.local
echo 'OPENCLAW_SIGNING_PRIVATE_KEY="..."' >> .env.local

# 3. Start your gateway
node gateway.js

# 4. Register in Astrid (use localhost for testing)
# Gateway URL: ws://localhost:3000
```
