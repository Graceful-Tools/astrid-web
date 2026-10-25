/**
 * Task AWTD-1369. The re-encryption pass rewrites stored values under the new
 * key. These are the decisions it must get right per column, tested without a
 * database.
 *
 * The one that matters most: a value no key can decrypt must be REPORTED, never
 * rewritten. Rewriting would mean inventing a plaintext, and the point of the
 * pass is that `failed > 0` stops the rotation before the old key is dropped.
 */
import { describe, it, expect } from 'vitest'
import {
  ENCRYPTED_COLUMNS,
  addOutcome,
  emptyOutcome,
  planColumn,
} from '@/lib/reencrypt-plan'

const deps = {
  isEncrypted: (v: string) => v.startsWith('enc:v1:'),
  decrypt: (v: string) => {
    if (v === 'enc:v1:undecryptable') throw new Error('Unsupported state or unable to authenticate data')
    if (v === 'enc:v1:null') return null
    return v.replace('enc:v1:', 'plain:')
  },
  encrypt: (v: string) => `enc:v1:re(${v})`,
}

describe('planColumn (AWTD-1369)', () => {
  it('rewrites an encrypted value under the current key', () => {
    expect(planColumn('enc:v1:abc', deps)).toEqual({ next: 'enc:v1:re(plain:abc)' })
  })

  it('leaves plaintext alone — decryptField passes it through, so rewriting would change what the app reads', () => {
    expect(planColumn('0771 123 4567', deps)).toEqual({ skip: true })
  })

  it('leaves null, undefined and empty alone', () => {
    expect(planColumn(null, deps)).toEqual({ skip: true })
    expect(planColumn(undefined, deps)).toEqual({ skip: true })
    expect(planColumn('', deps)).toEqual({ skip: true })
  })

  it('REPORTS a value no key can decrypt — it must never be rewritten', () => {
    expect(planColumn('enc:v1:undecryptable', deps)).toEqual({ failed: true })
  })

  it('treats a null decrypt result as a failure, not as an empty value to store', () => {
    expect(planColumn('enc:v1:null', deps)).toEqual({ failed: true })
  })

  it('is idempotent in shape — a rewritten value is still rewritable', () => {
    const first = planColumn('enc:v1:abc', deps)
    expect('next' in first).toBe(true)
    if (!('next' in first)) return
    // Re-running costs a write and a fresh IV, but never corrupts.
    expect(planColumn(first.next, deps)).toHaveProperty('next')
  })
})

describe('outcome arithmetic', () => {
  it('starts at zero and sums', () => {
    expect(emptyOutcome()).toEqual({ rewritten: 0, skipped: 0, failed: 0 })
    expect(
      addOutcome({ rewritten: 1, skipped: 2, failed: 3 }, { rewritten: 10, skipped: 20, failed: 30 }),
    ).toEqual({ rewritten: 11, skipped: 22, failed: 33 })
  })
})

describe('ENCRYPTED_COLUMNS', () => {
  it('covers every column written through field-encryption today', () => {
    const covered = ENCRYPTED_COLUMNS.flatMap(t => t.columns.map(c => `${t.table}.${c}`))
    expect(covered).toEqual([
      'AddressBookContact.name',
      'AddressBookContact.phoneNumber',
      'UserWebhookConfig.webhookUrl',
      'UserWebhookConfig.webhookSecret',
      'PushSubscription.p256dh',
      'PushSubscription.auth',
    ])
  })

  it('gives every table a stable cursor, or paging could skip or repeat rows', () => {
    for (const table of ENCRYPTED_COLUMNS) {
      expect(table.cursor).toBe('id')
      expect(table.columns.length).toBeGreaterThan(0)
      expect(table.model).toMatch(/^[a-z][A-Za-z]+$/)
    }
  })
})
