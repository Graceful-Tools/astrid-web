// @vitest-environment node
/**
 * AWTD-1465: what `/api/secure-files/:id` redirects to after its access check.
 *
 * Unchanged for Vercel Blob, S3 and local — the stored URL itself. Only a store
 * with its own endpoint (Azure Blob) swaps it for a short-lived signed URL.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { generateSignedDownloadUrl } from '@/lib/secure-storage'

const AZURITE =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;'

const ORIGINAL_ENV = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('generateSignedDownloadUrl (AWTD-1465)', () => {
  it('returns a Vercel Blob URL unchanged when nothing is configured (production today)', async () => {
    delete process.env.STORAGE_DRIVER
    const url = 'https://abc.public.blob.vercel-storage.com/files/u/a.pdf'
    expect(await generateSignedDownloadUrl(url, 300, 'application/pdf')).toBe(url)
  })

  it('returns a local-store URL unchanged', async () => {
    process.env.STORAGE_DRIVER = 'local'
    const url = 'https://tasks.example.com/api/v1/storage/objects/files/u/a.pdf'
    expect(await generateSignedDownloadUrl(url, 300)).toBe(url)
  })

  it('swaps an Azure-backed object URL for a five-minute read-only SAS', async () => {
    process.env.STORAGE_DRIVER = 'azure-blob'
    process.env.AZURE_STORAGE_CONTAINER = 'attachments'
    process.env.AZURE_STORAGE_CONNECTION_STRING = AZURITE
    const signed = await generateSignedDownloadUrl('https://tasks.example.com/api/v1/storage/objects/files/u/a.pdf', 300, 'application/pdf')
    expect(signed.startsWith('http://127.0.0.1:10000/devstoreaccount1/attachments/files/u/a.pdf?')).toBe(true)
    expect(new URL(signed).searchParams.get('sp')).toBe('r')
  })

  it('leaves a URL that is not one of ours alone, even on Azure', async () => {
    process.env.STORAGE_DRIVER = 'azure-blob'
    process.env.AZURE_STORAGE_CONTAINER = 'attachments'
    process.env.AZURE_STORAGE_CONNECTION_STRING = AZURITE
    const legacy = 'https://abc.public.blob.vercel-storage.com/files/u/old.pdf'
    expect(await generateSignedDownloadUrl(legacy, 300)).toBe(legacy)
  })
})
