// @vitest-environment node
/**
 * AWTD-1465: the Azure Blob store's signed reads, which need no server.
 *
 * Its put/get/delete are held to the shared contract against a real Azurite in
 * tests/integration/object-store-conformance.test.ts. A SAS is signed locally,
 * so its shape is checked here with no store at all: read-only, five minutes,
 * and signed by the account key or — under Managed Identity — by a
 * user-delegation key Azure issues to the identity.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { BlobServiceClient } from '@azure/storage-blob'
import { createAzureBlobObjectStore } from '@/lib/storage/azure-blob-object-store'

// Azurite's published development account; not a secret.
const AZURITE =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;'

afterEach(() => {
  vi.restoreAllMocks()
})

function sasOf(url: string) {
  return new URL(url).searchParams
}

describe('Azure Blob signed reads (AWTD-1465)', () => {
  it('signs a read-only, five-minute SAS with the account key from a connection string', async () => {
    const store = await createAzureBlobObjectStore({ AZURE_STORAGE_CONTAINER: 'attachments', AZURE_STORAGE_CONNECTION_STRING: AZURITE })
    const before = Date.now()
    const url = await store.signedReadUrl!('files/u/a.pdf', 300, 'application/pdf')

    expect(url.startsWith('http://127.0.0.1:10000/devstoreaccount1/attachments/files/u/a.pdf?')).toBe(true)
    const sas = sasOf(url)
    expect(sas.get('sp')).toBe('r')
    expect(sas.get('sr')).toBe('b')
    expect(sas.get('sig')).toBeTruthy()
    expect(sas.get('skoid')).toBeNull() // not a user-delegation SAS
    const expires = Date.parse(sas.get('se')!)
    expect(expires - before).toBeGreaterThan(290_000)
    expect(expires - before).toBeLessThanOrEqual(301_000)
    expect(sas.get('rscd')).toBe('inline')
    expect(sas.get('rsct')).toBe('application/pdf')
  })

  it('downloads rather than renders anything that is not media, a PDF or plain text', async () => {
    const store = await createAzureBlobObjectStore({ AZURE_STORAGE_CONTAINER: 'attachments', AZURE_STORAGE_CONNECTION_STRING: AZURITE })
    const url = await store.signedReadUrl!('files/u/page.html', 300, 'text/html')
    expect(sasOf(url).get('rscd')).toBe('attachment')
  })

  it('under Managed Identity, signs a user-delegation SAS that expires with the URL', async () => {
    const getKey = vi.spyOn(BlobServiceClient.prototype, 'getUserDelegationKey').mockResolvedValue({
      signedObjectId: '00000000-0000-0000-0000-00000000000a',
      signedTenantId: '00000000-0000-0000-0000-00000000000b',
      signedStartsOn: new Date(),
      signedExpiresOn: new Date(Date.now() + 300_000),
      signedService: 'b',
      signedVersion: '2025-01-05',
      value: Buffer.from('delegation-key').toString('base64'),
    } as never)
    const store = await createAzureBlobObjectStore({ AZURE_STORAGE_CONTAINER: 'attachments', AZURE_STORAGE_ACCOUNT: 'contoso' })
    const url = await store.signedReadUrl!('files/u/a.png', 300, 'image/png')

    expect(url.startsWith('https://contoso.blob.core.windows.net/attachments/files/u/a.png?')).toBe(true)
    expect(getKey).toHaveBeenCalledTimes(1)
    const [startsOn, expiresOn] = getKey.mock.calls[0] as unknown as [Date, Date]
    expect(expiresOn.getTime() - startsOn.getTime()).toBeLessThanOrEqual(361_000)
    const sas = sasOf(url)
    expect(sas.get('sp')).toBe('r')
    expect(sas.get('skoid')).toBe('00000000-0000-0000-0000-00000000000a')
    expect(sas.get('spr')).toBe('https')
  })

  it('never signs an unsafe pathname', async () => {
    const store = await createAzureBlobObjectStore({ AZURE_STORAGE_CONTAINER: 'attachments', AZURE_STORAGE_CONNECTION_STRING: AZURITE })
    await expect(store.signedReadUrl!('../other/x', 300)).rejects.toThrow(/Invalid object pathname/)
  })
})
