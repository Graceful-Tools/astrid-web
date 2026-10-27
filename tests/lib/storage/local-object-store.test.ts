/**
 * AWTD-1286: the local-disk store.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalObjectStore } from '@/lib/storage/local-object-store'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'local-store-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const bytes = (text: string) => new Uint8Array(Buffer.from(text))
const text = (body: unknown) => Buffer.from(body as Uint8Array).toString()

describe('local object store (AWTD-1286)', () => {
  it('round-trips bytes and content type', async () => {
    const store = createLocalObjectStore({ STORAGE_LOCAL_DIR: root })
    await store.put('files/u/a.txt', bytes('hello'), 'text/plain')
    const got = await store.get('files/u/a.txt')
    expect(text(got!.body)).toBe('hello')
    expect(got!.contentType).toBe('text/plain')
    expect(got!.size).toBe(5)
  })

  it('answers a range with its Content-Range', async () => {
    const store = createLocalObjectStore({ STORAGE_LOCAL_DIR: root })
    await store.put('files/u/v.mp4', bytes('0123456789'), 'video/mp4')
    const got = await store.get('files/u/v.mp4', 'bytes=2-4')
    expect(text(got!.body)).toBe('234')
    expect(got!.size).toBe(3)
    expect(got!.contentRange).toBe('bytes 2-4/10')
  })

  it('returns null for a missing object and deletes idempotently', async () => {
    const store = createLocalObjectStore({ STORAGE_LOCAL_DIR: root })
    expect(await store.get('files/u/none.txt')).toBeNull()
    await store.put('files/u/a.txt', bytes('x'), 'text/plain')
    await store.delete('files/u/a.txt')
    await store.delete('files/u/a.txt')
    expect(existsSync(join(root, 'files/u/a.txt'))).toBe(false)
    expect(existsSync(join(root, '.meta/files/u/a.txt.json'))).toBe(false)
  })

  it('refuses a pathname that would leave its directory', async () => {
    const store = createLocalObjectStore({ STORAGE_LOCAL_DIR: join(root, 'inner') })
    await expect(store.put('../escaped.txt', bytes('x'), 'text/plain')).rejects.toThrow(/Invalid object pathname/)
    await expect(store.get('files/../../escaped.txt')).rejects.toThrow(/Invalid object pathname/)
    expect(existsSync(join(root, 'escaped.txt'))).toBe(false)
  })
})
