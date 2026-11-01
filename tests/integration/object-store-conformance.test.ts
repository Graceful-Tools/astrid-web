// @vitest-environment node
/**
 * Object-store conformance (AWTD-1465): every driver, one assertion set.
 *
 * The assertions live in ./conformance/object-store-contract.ts; this file only
 * says how to build each driver. `local` always runs. Azure Blob runs against
 * Azurite whenever AZURITE_BLOB_CONNECTION_STRING is set — the unit-test CI job
 * starts an Azurite service container and sets it — and is reported as skipped,
 * not passed, when it is not. Locally:
 *
 *   npx azurite@3.37.0 azurite-blob --inMemoryPersistence --skipApiVersionCheck &   # or the Azurite container
 *   AZURITE_BLOB_CONNECTION_STRING='DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;' \
 *     npx vitest run tests/integration/object-store-conformance.test.ts
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BlobServiceClient } from '@azure/storage-blob'
import { createLocalObjectStore } from '@/lib/storage/local-object-store'
import { createAzureBlobObjectStore } from '@/lib/storage/azure-blob-object-store'
import { describeObjectStoreContract } from './conformance/object-store-contract'

let localRoot = ''
describeObjectStoreContract('local', {
  async create() {
    localRoot = mkdtempSync(join(tmpdir(), 'conformance-local-'))
    return createLocalObjectStore({ STORAGE_LOCAL_DIR: localRoot })
  },
  async cleanup() {
    rmSync(localRoot, { recursive: true, force: true })
  },
})

const azurite = process.env.AZURITE_BLOB_CONNECTION_STRING
const container = `conformance-${randomUUID().slice(0, 8)}`
describeObjectStoreContract(
  'azure-blob (Azurite)',
  azurite
    ? {
        async create() {
          await BlobServiceClient.fromConnectionString(azurite).getContainerClient(container).createIfNotExists()
          return createAzureBlobObjectStore({ AZURE_STORAGE_CONTAINER: container, AZURE_STORAGE_CONNECTION_STRING: azurite })
        },
        async cleanup() {
          await BlobServiceClient.fromConnectionString(azurite).getContainerClient(container).deleteIfExists()
        },
      }
    : null,
  'AZURITE_BLOB_CONNECTION_STRING is not set'
)

// Azure's one addition to the contract: a signed read URL a browser can follow.
;(azurite ? describe : describe.skip)('azure-blob signed reads against Azurite (AWTD-1465)', () => {
  it('serves the object at its SAS URL, and not without the signature', async () => {
    const name = `signed-${randomUUID().slice(0, 8)}`
    await BlobServiceClient.fromConnectionString(azurite!).getContainerClient(name).createIfNotExists()
    try {
      const store = await createAzureBlobObjectStore({ AZURE_STORAGE_CONTAINER: name, AZURE_STORAGE_CONNECTION_STRING: azurite })
      await store.put('files/u/a.txt', new Uint8Array(Buffer.from('signed bytes')), 'text/plain')
      const url = await store.signedReadUrl!('files/u/a.txt', 300, 'text/plain')

      const signed = await fetch(url)
      expect(signed.status).toBe(200)
      expect(await signed.text()).toBe('signed bytes')
      expect(signed.headers.get('content-disposition')).toBe('inline')

      const unsigned = await fetch(url.split('?')[0])
      expect(unsigned.status).not.toBe(200)
    } finally {
      await BlobServiceClient.fromConnectionString(azurite!).getContainerClient(name).deleteIfExists()
    }
  })
})
