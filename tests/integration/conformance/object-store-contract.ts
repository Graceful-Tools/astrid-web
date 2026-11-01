/**
 * The object-store contract: one set of assertions, every driver (AWTD-1465).
 *
 * `lib/storage/object-store.ts` promises put/get/delete with ranges, null for a
 * missing object, idempotent deletes and refusal of unsafe pathnames. Each
 * driver is registered once in tests/integration/object-store-conformance.test.ts
 * and gets every assertion below, with no test body copied per driver — so a
 * driver that behaves differently from the others fails here rather than in a
 * partner's deployment.
 *
 * The conformance harness (AWTD-1463, PLATFORM_ASSESSMENT_2026-11 §5), one
 * assertion set per seam, every implementation:
 * - object store: this contract — local, s3 (SeaweedFS), azure-blob (Azurite).
 * - email: tests/integration/email-transport-conformance.test.ts — Resend
 *   (mocked at the SDK) and SMTP (a real socket to ./smtp-sink.ts).
 * - realtime: the RealtimeBus (lib/realtime/) registers here when it lands —
 *   an Upstash mock and a real Redis, the same way.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { ObjectStore, StoredBytes } from '@/lib/storage/object-store'

export interface ObjectStoreDriver {
  /** Build the store; may provision what it needs (a container, a directory). */
  create(): Promise<ObjectStore>
  /** Tear down what `create` provisioned. */
  cleanup?(): Promise<void>
}

async function bytesOf(body: StoredBytes['body']): Promise<string> {
  if (body instanceof Uint8Array) return Buffer.from(body).toString()
  return Buffer.from(await new Response(body).arrayBuffer()).toString()
}

const encode = (text: string) => new Uint8Array(Buffer.from(text))

export function describeObjectStoreContract(name: string, driver: ObjectStoreDriver | null, skipReason?: string) {
  const suite = driver ? describe : describe.skip
  suite(`object store contract: ${name}${driver ? '' : ` (skipped: ${skipReason})`}`, () => {
    let store: ObjectStore
    // Unique per run, so a shared store (Azurite, a bucket) never sees a stale object.
    const prefix = `files/conformance-${randomUUID()}`

    beforeAll(async () => {
      store = await driver!.create()
    })

    afterAll(async () => {
      await driver!.cleanup?.()
    })

    it('round-trips bytes and content type', async () => {
      await store.put(`${prefix}/a.txt`, encode('hello'), 'text/plain')
      const got = await store.get(`${prefix}/a.txt`)
      expect(got).not.toBeNull()
      expect(await bytesOf(got!.body)).toBe('hello')
      expect(got!.contentType).toBe('text/plain')
      expect(got!.size).toBe(5)
      expect(got!.contentRange).toBeUndefined()
    })

    it('answers a range with its Content-Range', async () => {
      await store.put(`${prefix}/v.mp4`, encode('0123456789'), 'video/mp4')
      const got = await store.get(`${prefix}/v.mp4`, 'bytes=2-4')
      expect(await bytesOf(got!.body)).toBe('234')
      expect(got!.size).toBe(3)
      expect(got!.contentRange).toBe('bytes 2-4/10')
      expect(got!.contentType).toBe('video/mp4')
    })

    it('serves the whole object for a range it cannot satisfy', async () => {
      await store.put(`${prefix}/w.txt`, encode('whole'), 'text/plain')
      const got = await store.get(`${prefix}/w.txt`, 'bytes=99-')
      expect(await bytesOf(got!.body)).toBe('whole')
      expect(got!.contentRange).toBeUndefined()
    })

    it('replaces an object written twice under one pathname', async () => {
      await store.put(`${prefix}/r.txt`, encode('first'), 'text/plain')
      await store.put(`${prefix}/r.txt`, encode('second'), 'application/json')
      const got = await store.get(`${prefix}/r.txt`)
      expect(await bytesOf(got!.body)).toBe('second')
      expect(got!.contentType).toBe('application/json')
    })

    it('returns null for a missing object', async () => {
      expect(await store.get(`${prefix}/never-written.txt`)).toBeNull()
    })

    it('deletes, and a second delete of the same object succeeds', async () => {
      await store.put(`${prefix}/d.txt`, encode('x'), 'text/plain')
      await store.delete(`${prefix}/d.txt`)
      await store.delete(`${prefix}/d.txt`)
      expect(await store.get(`${prefix}/d.txt`)).toBeNull()
    })

    it('refuses a pathname that could leave the store', async () => {
      await expect(store.put('../escaped.txt', encode('x'), 'text/plain')).rejects.toThrow(/Invalid object pathname/)
      await expect(store.get('files/../../escaped.txt')).rejects.toThrow(/Invalid object pathname/)
    })
  })
}
