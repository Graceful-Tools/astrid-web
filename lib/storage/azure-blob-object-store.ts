/**
 * Objects in an Azure Blob Storage container (`STORAGE_DRIVER=azure-blob`, AWTD-1465).
 *
 * Azure Blob does not speak S3, so it gets its own driver beside
 * `s3-object-store.ts`, behind the same `ObjectStore` contract — one code
 * path, backend chosen by env (docs/architecture/PLATFORM_ASSESSMENT_2026-11.md §5):
 *
 * - `AZURE_STORAGE_CONTAINER`: required. Kept private.
 * - `AZURE_STORAGE_CONNECTION_STRING`: authenticate with the account key it
 *   carries (and reach whatever `BlobEndpoint` it names — Azurite included).
 * - otherwise `AZURE_STORAGE_ACCOUNT`, authenticated by `DefaultAzureCredential`:
 *   a Managed Identity on Container Apps or App Service, `az login` locally.
 *   The identity needs "Storage Blob Data Contributor" on the container (and
 *   "Storage Blob Delegator" on the account, for signed reads).
 *
 * Like the S3 store, objects are served by the app at
 * `/api/v1/storage/objects/…`. `signedReadUrl` is the one extra: a 5-minute
 * read-only SAS (a user-delegation SAS under Managed Identity) that
 * `/api/secure-files/:id` redirects to after its permission check, so file
 * bytes are fetched from Azure directly rather than proxied by the app.
 */

import { Readable } from 'node:stream'
import {
  BlobSASPermissions,
  BlobServiceClient,
  RestError,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  type ContainerClient,
} from '@azure/storage-blob'
import { isSafeObjectPathname, parseByteRange, type ObjectStore, type StorageEnv } from './object-store'

/** Whether a response asked for something that is not there. */
function isNotFound(error: unknown): boolean {
  return error instanceof RestError ? error.statusCode === 404 : (error as { statusCode?: number })?.statusCode === 404
}

function toWebStream(body: NodeJS.ReadableStream | undefined): ReadableStream<Uint8Array> {
  if (!body) return new ReadableStream({ start: controller => controller.close() })
  return Readable.toWeb(body as Readable) as ReadableStream<Uint8Array>
}

async function serviceClient(env: StorageEnv): Promise<BlobServiceClient> {
  const connectionString = env.AZURE_STORAGE_CONNECTION_STRING?.trim()
  if (connectionString) return BlobServiceClient.fromConnectionString(connectionString)
  // Loaded only for the Managed Identity path.
  const { DefaultAzureCredential } = await import('@azure/identity')
  const account = env.AZURE_STORAGE_ACCOUNT!.trim()
  return new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential())
}

/** Content types a signed read may show inline; the rest download (as the app's own route does). */
const INLINE = /^(image\/(png|jpeg|gif|webp|heic|heif|avif)|video\/|audio\/|application\/pdf$|text\/plain$)/

export async function createAzureBlobObjectStore(env: StorageEnv): Promise<ObjectStore> {
  const service = await serviceClient(env)
  const container: ContainerClient = service.getContainerClient(env.AZURE_STORAGE_CONTAINER!.trim())

  function blob(pathname: string) {
    if (!isSafeObjectPathname(pathname)) throw new Error('Invalid object pathname')
    return container.getBlockBlobClient(pathname)
  }

  return {
    async put(pathname, body, contentType) {
      await blob(pathname).uploadData(body, { blobHTTPHeaders: { blobContentType: contentType } })
    },

    async get(pathname, range) {
      const client = blob(pathname)
      try {
        if (range) {
          const { contentLength = 0 } = await client.getProperties()
          const bytes = parseByteRange(range, contentLength)
          if (bytes) {
            const count = bytes.end - bytes.start + 1
            const response = await client.download(bytes.start, count)
            return {
              body: toWebStream(response.readableStreamBody),
              contentType: response.contentType || 'application/octet-stream',
              size: count,
              contentRange: `bytes ${bytes.start}-${bytes.end}/${contentLength}`,
            }
          }
        }
        const response = await client.download(0)
        return {
          body: toWebStream(response.readableStreamBody),
          contentType: response.contentType || 'application/octet-stream',
          ...(response.contentLength !== undefined ? { size: response.contentLength } : {}),
        }
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },

    async delete(pathname) {
      await blob(pathname).deleteIfExists()
    },

    async signedReadUrl(pathname, expiresInSeconds, contentType) {
      const client = blob(pathname)
      const startsOn = new Date(Date.now() - 60_000) // clock skew
      const expiresOn = new Date(Date.now() + expiresInSeconds * 1000)
      const options = {
        containerName: container.containerName,
        blobName: pathname,
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn,
        protocol: client.url.startsWith('https:') ? SASProtocol.Https : SASProtocol.HttpsAndHttp,
        ...(contentType ? { contentType, contentDisposition: INLINE.test(contentType) ? 'inline' : 'attachment' } : {}),
      }
      if (service.credential instanceof StorageSharedKeyCredential) {
        const sas = generateBlobSASQueryParameters(options, service.credential).toString()
        return `${client.url}?${sas}`
      }
      // Managed Identity: a user-delegation SAS, signed by a key Azure issues
      // to the identity and that expires with the URL.
      const key = await service.getUserDelegationKey(startsOn, expiresOn)
      const sas = generateBlobSASQueryParameters(options, key, service.accountName).toString()
      return `${client.url}?${sas}`
    },
  }
}
