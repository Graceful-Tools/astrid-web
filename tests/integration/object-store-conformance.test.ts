// @vitest-environment node
/**
 * Object-store conformance (AWTD-1465, AWTD-1463): every driver, one assertion set.
 *
 * The assertions live in ./conformance/object-store-contract.ts; this file only
 * says how to build each driver. `local` always runs. `s3` runs against
 * SeaweedFS whenever S3_CONFORMANCE_ENDPOINT is set, and Azure Blob against
 * Azurite whenever AZURITE_BLOB_CONNECTION_STRING is set — the unit-test CI job
 * starts both containers and sets both — and each is reported as skipped, not
 * passed, when its variable is not. Locally:
 *
 *   weed server -s3 -dir=/tmp/seaweed &            # or chrislusf/seaweedfs:4.51
 *   S3_CONFORMANCE_ENDPOINT=http://127.0.0.1:8333 npx vitest run tests/integration/object-store-conformance.test.ts
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
import { AwsClient } from 'aws4fetch'
import { createLocalObjectStore } from '@/lib/storage/local-object-store'
import { createS3ObjectStore } from '@/lib/storage/s3-object-store'
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

// SeaweedFS with no identities configured accepts any SigV4 key pair, so the
// driver signs exactly as it would against AWS, MinIO or R2.
const s3Endpoint = process.env.S3_CONFORMANCE_ENDPOINT?.replace(/\/+$/, '')
const bucket = `conformance-${randomUUID().slice(0, 8)}`
const s3Env = { S3_BUCKET: bucket, S3_ENDPOINT: s3Endpoint, S3_ACCESS_KEY_ID: 'conformance', S3_SECRET_ACCESS_KEY: 'conformance' }
describeObjectStoreContract(
  's3 (SeaweedFS)',
  s3Endpoint
    ? {
        async create() {
          const admin = new AwsClient({ accessKeyId: 'conformance', secretAccessKey: 'conformance', region: 'us-east-1', service: 's3' })
          const created = await admin.fetch(`${s3Endpoint}/${bucket}`, { method: 'PUT' })
          if (!created.ok) throw new Error(`could not create bucket ${bucket}: HTTP ${created.status}`)
          return createS3ObjectStore(s3Env)
        },
      }
    : null,
  'S3_CONFORMANCE_ENDPOINT is not set'
)

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
