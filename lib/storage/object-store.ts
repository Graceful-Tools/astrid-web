/**
 * Where uploaded bytes live, when it is not Vercel Blob (AWTD-1286).
 *
 * A self-hosted deployment has no Vercel Blob store. `STORAGE_DRIVER` picks
 * one of:
 *
 * - `vercel-blob` (the default): hosted Astrid, unchanged. The SDK calls stay
 *   in `lib/secure-storage.ts`, the one module allowed to name that vendor.
 * - `s3`: any S3-compatible store (AWS S3, MinIO, Cloudflare R2, Ceph).
 * - `local`: a directory on a mounted volume, for a single server.
 * - `azure-blob`: an Azure Blob Storage container (AWTD-1465), which does not
 *   speak S3.
 *
 * With any of the last three the app serves the objects itself, at
 * `/api/v1/storage/objects/<pathname>`, and accepts direct uploads at
 * `/api/v1/storage/uploads/<token>` (lib/storage/upload-token.ts). That keeps
 * the clients unchanged: they already PUT to whatever URL the server hands
 * out, and read whatever URL a file row stores.
 */

import { getBaseUrl } from '@/lib/base-url'
import { createLogger } from '@/lib/logger'

const log = createLogger('object-store')

/** The variables storage reads. `process.env` is one; tests pass a plain object. */
export type StorageEnv = Record<string, string | undefined>

export const STORAGE_DRIVERS = ['vercel-blob', 's3', 'local', 'azure-blob'] as const
export type StorageDriver = (typeof STORAGE_DRIVERS)[number]

/** The path prefix self-hosted objects are served under. */
export const OBJECT_ROUTE_PREFIX = '/api/v1/storage/objects/'

/** The path prefix self-hosted direct uploads are PUT to. */
export const UPLOAD_ROUTE_PREFIX = '/api/v1/storage/uploads/'

/**
 * The configured driver. An unrecognised value is an error rather than a
 * fallback: silently writing to Vercel Blob on a deployment that asked for S3
 * is exactly the failure a self-hoster cannot see until uploads vanish.
 */
export function storageDriver(env: StorageEnv = process.env): StorageDriver {
  const raw = env.STORAGE_DRIVER?.trim().toLowerCase()
  if (!raw) return 'vercel-blob'
  if ((STORAGE_DRIVERS as readonly string[]).includes(raw)) return raw as StorageDriver
  throw new Error(`STORAGE_DRIVER="${env.STORAGE_DRIVER}" is not one of ${STORAGE_DRIVERS.join(', ')}`)
}

/** Whether objects are stored and served by this app rather than by Vercel Blob. */
export function isSelfHostedStorage(env: StorageEnv = process.env): boolean {
  return storageDriver(env) !== 'vercel-blob'
}

/** Settings each driver cannot run without. */
const REQUIRED_SETTINGS: Record<StorageDriver, string[]> = {
  'vercel-blob': [],
  s3: ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
  local: [],
  'azure-blob': ['AZURE_STORAGE_CONTAINER'],
}

/**
 * The settings missing for the configured driver, by name. Called at server
 * start (instrumentation.ts), so a self-hosted deployment with half an S3
 * configuration refuses to boot instead of failing on the first upload.
 */
export function missingStorageSettings(env: StorageEnv = process.env): string[] {
  const driver = storageDriver(env)
  const missing = REQUIRED_SETTINGS[driver].filter(name => !env[name]?.trim())
  if (driver === 's3' && !env.S3_REGION?.trim() && !env.S3_ENDPOINT?.trim()) {
    missing.push('S3_REGION or S3_ENDPOINT')
  }
  if (driver === 'azure-blob' && !env.AZURE_STORAGE_CONNECTION_STRING?.trim() && !env.AZURE_STORAGE_ACCOUNT?.trim()) {
    missing.push('AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT')
  }
  return missing
}

export function assertStorageConfiguration(env: StorageEnv = process.env): void {
  const missing = missingStorageSettings(env)
  if (missing.length > 0) {
    throw new Error(`STORAGE_DRIVER=${storageDriver(env)} is missing: ${missing.join(', ')}`)
  }
}

/** An object, or the requested range of one, read back from the store. */
export interface StoredBytes {
  body: ReadableStream<Uint8Array> | Uint8Array
  contentType: string
  /** Length of `body`. */
  size?: number
  /** Set when `body` is a range: the `Content-Range` to answer 206 with. */
  contentRange?: string
}

/** The three operations a self-hosted store provides. */
export interface ObjectStore {
  put(pathname: string, body: Uint8Array, contentType: string): Promise<void>
  /**
   * Null when there is no such object. `range` is a request's `Range` header;
   * a store may ignore it and return the whole object, as HTTP allows.
   */
  get(pathname: string, range?: string | null): Promise<StoredBytes | null>
  /** Succeeds when the object is already gone. */
  delete(pathname: string): Promise<void>
  /**
   * A short-lived, read-only URL straight to the store, for a store that has
   * its own public endpoint (Azure Blob's SAS, AWTD-1465). Optional: without
   * it the app serves the object itself at OBJECT_ROUTE_PREFIX.
   * `contentType` decides whether the store serves it inline or as a download.
   */
  signedReadUrl?(pathname: string, expiresInSeconds: number, contentType?: string): Promise<string>
}

/**
 * Object pathnames are ours (`files/<userId>/<uuid>.<ext>`, `uploads/…`), but
 * one also arrives in a public URL, so it is checked before any store sees it.
 * No empty segments, none starting with a dot (so no `..`), no absolute paths,
 * a conservative alphabet. The local store also checks the resolved path stays inside its
 * root; this check makes that one unreachable.
 */
export function isSafeObjectPathname(pathname: string): boolean {
  if (!pathname || pathname.length > 512) return false
  if (!/^[A-Za-z0-9._\-/]+$/.test(pathname)) return false
  // No empty segment, and none starting with a dot: that rules out `.` and `..`,
  // and keeps the local store's `.meta/` sidecars out of reach of a URL.
  return pathname.split('/').every(segment => segment !== '' && !segment.startsWith('.'))
}

/** The public URL a self-hosted object is served from. */
export function selfHostedObjectUrl(pathname: string): string {
  return `${getBaseUrl()}${OBJECT_ROUTE_PREFIX}${pathname}`
}

/**
 * The store pathname inside an object URL, for either store: a Blob URL's
 * path, or what follows the route prefix of a self-hosted one.
 */
export function objectPathnameFromUrl(objectUrl: string): string | null {
  try {
    const { pathname } = new URL(objectUrl)
    if (pathname.startsWith(OBJECT_ROUTE_PREFIX)) return pathname.slice(OBJECT_ROUTE_PREFIX.length)
    return pathname.startsWith('/') ? pathname.slice(1) : pathname
  } catch {
    return null
  }
}

/**
 * The store pathname of a URL this app serves an object from, or null for any
 * other URL (a Vercel Blob URL left from before a migration, say).
 */
export function selfHostedObjectPathname(objectUrl: string): string | null {
  try {
    const { pathname } = new URL(objectUrl)
    if (!pathname.startsWith(OBJECT_ROUTE_PREFIX)) return null
    const objectPath = pathname.slice(OBJECT_ROUTE_PREFIX.length)
    return isSafeObjectPathname(objectPath) ? objectPath : null
  } catch {
    return null
  }
}

/** The URL a client PUTs a direct upload to. */
export function selfHostedUploadUrl(token: string): string {
  return `${getBaseUrl()}${UPLOAD_ROUTE_PREFIX}${token}`
}

/**
 * One `bytes=` range against an object of `total` bytes, as inclusive offsets,
 * or null to serve the whole object. Video needs this: AVPlayer and Safari
 * will not play a source that ignores Range. Multi-range and unsatisfiable
 * requests get the whole object, which RFC 9110 permits.
 */
export function parseByteRange(header: string | null | undefined, total: number): { start: number; end: number } | null {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!match || total <= 0) return null
  const [, from, to] = match
  if (!from && !to) return null
  let start: number
  let end: number
  if (!from) {
    // A suffix: the last N bytes.
    start = Math.max(0, total - Number(to))
    end = total - 1
  } else {
    start = Number(from)
    end = to ? Math.min(Number(to), total - 1) : total - 1
  }
  if (start > end || start >= total) return null
  return { start, end }
}

let cached: { key: string; store: ObjectStore } | null = null

/** The store for the configured self-hosted driver, rebuilt when any of its settings changes (a rotated key included). */
export async function selfHostedObjectStore(): Promise<ObjectStore> {
  const driver = storageDriver()
  const key = [process.env.STORAGE_DRIVER, process.env.STORAGE_LOCAL_DIR, process.env.S3_BUCKET, process.env.S3_REGION,
    process.env.S3_ENDPOINT, process.env.S3_ACCESS_KEY_ID, process.env.S3_SECRET_ACCESS_KEY,
    process.env.AZURE_STORAGE_CONTAINER, process.env.AZURE_STORAGE_ACCOUNT, process.env.AZURE_STORAGE_CONNECTION_STRING].join('|')
  if (cached?.key === key) return cached.store
  let store: ObjectStore
  if (driver === 's3') {
    const { createS3ObjectStore } = await import('./s3-object-store')
    store = createS3ObjectStore(process.env)
  } else if (driver === 'azure-blob') {
    const { createAzureBlobObjectStore } = await import('./azure-blob-object-store')
    store = await createAzureBlobObjectStore(process.env)
  } else if (driver === 'local') {
    const { createLocalObjectStore } = await import('./local-object-store')
    store = createLocalObjectStore(process.env)
  } else {
    throw new Error('Vercel Blob is not a self-hosted store; use lib/secure-storage.ts')
  }
  log.info({ driver }, 'Self-hosted object storage selected')
  cached = { key, store }
  return store
}
