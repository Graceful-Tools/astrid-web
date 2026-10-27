/**
 * Objects as files on a mounted volume (`STORAGE_DRIVER=local`, AWTD-1286).
 *
 * For a single-server deployment. The directory is `STORAGE_LOCAL_DIR`
 * (default `./data/uploads`), and it must be a persistent volume: in a
 * container's writable layer, every upload disappears with the container.
 *
 * Each object's content type is kept beside it under `.meta/`, which no object
 * pathname can reach because pathnames may not have dot segments.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { isSafeObjectPathname, parseByteRange, type ObjectStore, type StorageEnv } from './object-store'

export function createLocalObjectStore(env: StorageEnv): ObjectStore {
  const root = resolve(env.STORAGE_LOCAL_DIR?.trim() || './data/uploads')

  function pathsFor(pathname: string): { data: string; meta: string } {
    if (!isSafeObjectPathname(pathname)) throw new Error('Invalid object pathname')
    const data = resolve(root, pathname)
    // Unreachable after the check above; kept because this is the line that
    // stands between a URL and the filesystem.
    if (!data.startsWith(root + sep)) throw new Error('Invalid object pathname')
    return { data, meta: join(root, '.meta', `${pathname}.json`) }
  }

  return {
    async put(pathname, body, contentType) {
      const { data, meta } = pathsFor(pathname)
      await mkdir(dirname(data), { recursive: true })
      await mkdir(dirname(meta), { recursive: true })
      await writeFile(data, body)
      await writeFile(meta, JSON.stringify({ contentType }))
    },

    async get(pathname, range) {
      const { data, meta } = pathsFor(pathname)
      let size: number
      try {
        size = (await stat(data)).size
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
      let contentType = 'application/octet-stream'
      try {
        const parsed = JSON.parse(await readFile(meta, 'utf8')) as { contentType?: unknown }
        if (typeof parsed.contentType === 'string') contentType = parsed.contentType
      } catch {
        // A missing sidecar serves as octet-stream rather than failing the read.
      }
      const bytes = new Uint8Array(await readFile(data))
      const span = parseByteRange(range, size)
      if (!span) return { body: bytes, contentType, size }
      return {
        body: bytes.subarray(span.start, span.end + 1),
        contentType,
        size: span.end - span.start + 1,
        contentRange: `bytes ${span.start}-${span.end}/${size}`,
      }
    },

    async delete(pathname) {
      const { data, meta } = pathsFor(pathname)
      await rm(data, { force: true })
      await rm(meta, { force: true })
    },
  }
}
