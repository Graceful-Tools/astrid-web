/**
 * Objects in an S3-compatible bucket (`STORAGE_DRIVER=s3`, AWTD-1286).
 *
 * Signed with SigV4 by `aws4fetch`, which speaks plain `fetch`, so the same
 * code reaches AWS S3, MinIO, Cloudflare R2 and Ceph:
 *
 * - `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: required.
 * - `S3_REGION`: the bucket's region. Defaults to `us-east-1`, which is what
 *   MinIO and R2 (`auto` also works there) expect.
 * - `S3_ENDPOINT`: the store's origin, for anything that is not AWS. When set,
 *   requests are path-style (`<endpoint>/<bucket>/<key>`), which every
 *   S3-compatible store accepts; without it they go to AWS's virtual-hosted
 *   bucket host.
 *
 * The bucket stays private. The app reads objects with its own credentials and
 * serves them, so no bucket policy, public ACL or CORS rule is needed.
 */

import { AwsClient } from 'aws4fetch'
import { isSafeObjectPathname, type ObjectStore, type StorageEnv } from './object-store'

export function createS3ObjectStore(env: StorageEnv): ObjectStore {
  const bucket = env.S3_BUCKET!.trim()
  const region = env.S3_REGION?.trim() || 'us-east-1'
  const endpoint = env.S3_ENDPOINT?.trim().replace(/\/+$/, '')
  const client = new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim(),
    region,
    service: 's3',
  })

  function urlFor(pathname: string): string {
    if (!isSafeObjectPathname(pathname)) throw new Error('Invalid object pathname')
    return endpoint
      ? `${endpoint}/${encodeURIComponent(bucket)}/${pathname}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${pathname}`
  }

  async function failure(operation: string, response: Response): Promise<Error> {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    return new Error(`S3 ${operation} failed: ${response.status} ${detail}`)
  }

  return {
    async put(pathname, body, contentType) {
      const response = await client.fetch(urlFor(pathname), {
        method: 'PUT',
        body: body as BodyInit,
        headers: { 'content-type': contentType },
      })
      if (!response.ok) throw await failure('PUT', response)
    },

    async get(pathname, range) {
      // The store answers a Range itself; its 206 and Content-Range pass through.
      let response = await client.fetch(urlFor(pathname), {
        method: 'GET',
        ...(range ? { headers: { range } } : {}),
      })
      // Unsatisfiable: serve the whole object, as the local store does.
      if (response.status === 416) response = await client.fetch(urlFor(pathname), { method: 'GET' })
      if (response.status === 404) return null
      if (!response.ok || !response.body) throw await failure('GET', response)
      const length = response.headers.get('content-length')
      return {
        body: response.body,
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        ...(length ? { size: Number(length) } : {}),
        ...(response.status === 206 && response.headers.get('content-range')
          ? { contentRange: response.headers.get('content-range')! }
          : {}),
      }
    },

    async delete(pathname) {
      const response = await client.fetch(urlFor(pathname), { method: 'DELETE' })
      // S3 answers 204 whether or not the key existed; some stores answer 404.
      if (!response.ok && response.status !== 404) throw await failure('DELETE', response)
    },
  }
}
