/**
 * AWTD-1286: picking and checking the self-hosted storage driver.
 */
import { describe, it, expect } from 'vitest'
import {
  isSafeObjectPathname,
  isSelfHostedStorage,
  missingStorageSettings,
  parseByteRange,
  storageDriver,
} from '@/lib/storage/object-store'

describe('storageDriver (AWTD-1286)', () => {
  it('defaults to Vercel Blob, so a deployment that sets nothing is unchanged', () => {
    expect(storageDriver({})).toBe('vercel-blob')
    expect(isSelfHostedStorage({})).toBe(false)
  })

  it('reads s3 and local, case-insensitively', () => {
    expect(storageDriver({ STORAGE_DRIVER: 'S3' })).toBe('s3')
    expect(storageDriver({ STORAGE_DRIVER: ' local ' })).toBe('local')
    expect(isSelfHostedStorage({ STORAGE_DRIVER: 'local' })).toBe(true)
  })

  it('reads azure-blob (AWTD-1465)', () => {
    expect(storageDriver({ STORAGE_DRIVER: 'Azure-Blob' })).toBe('azure-blob')
    expect(isSelfHostedStorage({ STORAGE_DRIVER: 'azure-blob' })).toBe(true)
  })

  it('refuses an unknown driver rather than falling back to Blob', () => {
    expect(() => storageDriver({ STORAGE_DRIVER: 'gcs' })).toThrow(/not one of/)
  })
})

describe('missingStorageSettings (AWTD-1286)', () => {
  it('needs nothing for Blob or local', () => {
    expect(missingStorageSettings({})).toEqual([])
    expect(missingStorageSettings({ STORAGE_DRIVER: 'local' })).toEqual([])
  })

  it('names every missing S3 setting', () => {
    expect(missingStorageSettings({ STORAGE_DRIVER: 's3' })).toEqual([
      'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION or S3_ENDPOINT',
    ])
  })

  it('names every missing Azure Blob setting (AWTD-1465)', () => {
    expect(missingStorageSettings({ STORAGE_DRIVER: 'azure-blob' })).toEqual([
      'AZURE_STORAGE_CONTAINER', 'AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT',
    ])
  })

  it('accepts Azure Blob by connection string or by account (Managed Identity) (AWTD-1465)', () => {
    expect(missingStorageSettings({
      STORAGE_DRIVER: 'azure-blob', AZURE_STORAGE_CONTAINER: 'attachments', AZURE_STORAGE_CONNECTION_STRING: 'x',
    })).toEqual([])
    expect(missingStorageSettings({
      STORAGE_DRIVER: 'azure-blob', AZURE_STORAGE_CONTAINER: 'attachments', AZURE_STORAGE_ACCOUNT: 'acct',
    })).toEqual([])
  })

  it('accepts an endpoint in place of a region', () => {
    expect(missingStorageSettings({
      STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
      S3_ENDPOINT: 'http://minio:9000',
    })).toEqual([])
  })
})

describe('isSafeObjectPathname (AWTD-1286)', () => {
  it('accepts the pathnames the app writes', () => {
    expect(isSafeObjectPathname('files/user-1/0b5c.pdf')).toBe(true)
    expect(isSafeObjectPathname('uploads/u/abc-123.png')).toBe(true)
  })

  it.each([
    '../etc/passwd', 'files/../../x', 'files/./x', '/files/x', 'files//x', '.meta/files/x.json',
    'files/x y', 'files/%2e%2e/x', '',
  ])('refuses %j', pathname => {
    expect(isSafeObjectPathname(pathname)).toBe(false)
  })
})

describe('parseByteRange (AWTD-1286)', () => {
  it('reads a closed, open and suffix range', () => {
    expect(parseByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
  })

  it('clamps an end past the object', () => {
    expect(parseByteRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 })
  })

  it('serves the whole object for anything it cannot honour', () => {
    expect(parseByteRange(null, 100)).toBeNull()
    expect(parseByteRange('bytes=200-', 100)).toBeNull()
    expect(parseByteRange('bytes=0-1,5-6', 100)).toBeNull()
    expect(parseByteRange('items=0-1', 100)).toBeNull()
    expect(parseByteRange('bytes=-', 100)).toBeNull()
  })
})
