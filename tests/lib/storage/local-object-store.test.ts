/**
 * AWTD-1286: what is particular to the local-disk store.
 *
 * Round-trips, ranges, missing objects and idempotent deletes are the contract
 * every driver meets, asserted once for all of them in
 * tests/integration/object-store-conformance.test.ts (AWTD-1463). What stays
 * here is how this one lays bytes out on disk.
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

describe('local object store (AWTD-1286)', () => {
  it('writes the object and its content-type sidecar, and a delete removes both', async () => {
    const store = createLocalObjectStore({ STORAGE_LOCAL_DIR: root })
    await store.put('files/u/a.txt', bytes('x'), 'text/plain')
    expect(existsSync(join(root, 'files/u/a.txt'))).toBe(true)
    expect(existsSync(join(root, '.meta/files/u/a.txt.json'))).toBe(true)
    await store.delete('files/u/a.txt')
    expect(existsSync(join(root, 'files/u/a.txt'))).toBe(false)
    expect(existsSync(join(root, '.meta/files/u/a.txt.json'))).toBe(false)
  })

  it('never writes outside its directory', async () => {
    const store = createLocalObjectStore({ STORAGE_LOCAL_DIR: join(root, 'inner') })
    await expect(store.put('../escaped.txt', bytes('x'), 'text/plain')).rejects.toThrow(/Invalid object pathname/)
    expect(existsSync(join(root, 'escaped.txt'))).toBe(false)
  })
})
