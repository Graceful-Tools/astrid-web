// @vitest-environment node
/**
 * AWTD-1530: duplicating a stored object, on the real local store. A copied task's comment files
 * get their own objects, so the copy survives the original being deleted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyStoredObject, deleteObject, putObject } from '@/lib/secure-storage'
import { selfHostedObjectStore } from '@/lib/storage/object-store'

const saved = { ...process.env }
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'copy-object-'))
  process.env.STORAGE_DRIVER = 'local'
  process.env.STORAGE_LOCAL_DIR = root
  process.env.NEXTAUTH_URL = 'https://tasks.example.test'
  delete process.env.VERCEL_URL
  delete process.env.BLOB_READ_WRITE_TOKEN
})

afterEach(() => {
  process.env = { ...saved }
  rmSync(root, { recursive: true, force: true })
})

async function bytesAt(pathname: string) {
  const got = await (await selfHostedObjectStore()).get(pathname)
  if (!got) return null
  const bytes = got.body instanceof Uint8Array ? got.body : new Uint8Array(await new Response(got.body).arrayBuffer())
  return Buffer.from(bytes).toString()
}

describe('copyStoredObject (AWTD-1530)', () => {
  it('writes an independent copy at the new path', async () => {
    const original = await putObject('files/u-1/a.txt', Buffer.from('hello'), { contentType: 'text/plain' })
    const copy = await copyStoredObject(original.url, 'files/u-2/b.txt', { contentType: 'text/plain' })

    expect(copy.pathname).toBe('files/u-2/b.txt')
    expect(copy.url).not.toBe(original.url)
    await deleteObject(original.url)
    expect(await bytesAt('files/u-1/a.txt')).toBeNull()
    expect(await bytesAt('files/u-2/b.txt')).toBe('hello')
  })

  it('rejects when the source is gone', async () => {
    const original = await putObject('files/u-1/gone.txt', Buffer.from('x'))
    await deleteObject(original.url)
    await expect(copyStoredObject(original.url, 'files/u-2/c.txt')).rejects.toThrow()
  })
})
