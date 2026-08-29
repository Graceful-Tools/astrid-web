import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent } from 'undici'

export const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 10_000

const IMAGE_CONTENT_TYPES = new Map([
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

export class RemoteImageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'RemoteImageError'
  }
}

function allowedHosts(): Set<string> {
  return new Set(
    (process.env.REMOTE_IMAGE_ALLOWED_HOSTS || '')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean),
  )
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return true
  const [a, b] = parts

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  )
}

function isBlockedIp(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isBlockedIpv4(address)
  if (version !== 6) return true

  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) {
    return isBlockedIpv4(normalized.slice('::ffff:'.length))
  }

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8')
  )
}

interface ResolvedAddress {
  address: string
  family: 4 | 6
}

async function validateRemoteUrl(url: URL): Promise<ResolvedAddress> {
  if (url.protocol !== 'https:') {
    throw new RemoteImageError('Only HTTPS image URLs are allowed', 400)
  }
  if (url.username || url.password || url.port) {
    throw new RemoteImageError('Image URL contains unsupported credentials or port', 400)
  }
  if (!allowedHosts().has(url.hostname.toLowerCase())) {
    throw new RemoteImageError('Image host is not approved', 400)
  }

  let addresses
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true })
  } catch {
    throw new RemoteImageError('Image host could not be resolved', 400)
  }
  if (addresses.length === 0 || addresses.some(result => isBlockedIp(result.address))) {
    throw new RemoteImageError('Image host resolves to a restricted address', 400)
  }
  return addresses[0] as ResolvedAddress
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new RemoteImageError('Image is too large', 413)
  }
  if (!response.body) {
    throw new RemoteImageError('Image response was empty', 422)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_REMOTE_IMAGE_BYTES) {
        await reader.cancel()
        throw new RemoteImageError('Image is too large', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const image = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    image.set(chunk, offset)
    offset += chunk.byteLength
  }
  return image
}

export interface RemoteImage {
  bytes: Uint8Array
  contentType: string
  extension: string
}

export async function downloadRemoteImage(rawUrl: string): Promise<RemoteImage> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new RemoteImageError('Image URL is invalid', 400)
  }

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const resolved = await validateRemoteUrl(url)
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, _options, callback) => {
          callback(null, resolved.address, resolved.family)
        },
      },
    })

    try {
      let response: Response
      try {
        response = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          dispatcher,
        } as RequestInit & { dispatcher: Agent })
      } catch {
        throw new RemoteImageError('Image download failed', 502)
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location || redirects === MAX_REDIRECTS) {
          throw new RemoteImageError('Image redirect was invalid', 400)
        }
        try {
          url = new URL(location, url)
        } catch {
          throw new RemoteImageError('Image redirect was invalid', 400)
        }
        continue
      }

      if (!response.ok) {
        await response.body?.cancel()
        throw new RemoteImageError('Image download failed', 502)
      }

      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      const extension = contentType && IMAGE_CONTENT_TYPES.get(contentType)
      if (!contentType || !extension) {
        await response.body?.cancel()
        throw new RemoteImageError('URL did not return a supported image', 415)
      }

      return {
        bytes: await readBoundedBody(response),
        contentType,
        extension,
      }
    } finally {
      await dispatcher.close()
    }
  }

  throw new RemoteImageError('Image redirect limit exceeded', 400)
}
