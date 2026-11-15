/**
 * AWTD-1668 — every runtime-binding audit row goes through one helper, and that
 * helper never lets a secret or prompt reach the table (RFC §7: "Never record
 * tokens, headers, webhook secrets, raw prompts, endpoint credentials or
 * payment information").
 */
import { describe, expect, it, vi } from 'vitest'
import { recordRuntimeBindingAudit, sanitizeAuditDetails } from '@/lib/runtime-binding/audit'

describe('AWTD-1668 runtime binding audit helper', () => {
  it('strips secret- and prompt-shaped keys at any depth', () => {
    const cleaned = sanitizeAuditDetails({
      changedFields: ['credentialRef', 'maxConcurrentRuns'],
      credentialRef: 'cred:abc',
      endpointRef: 'endpoint:abc',
      billingAccountRef: 'payer:abc',
      nested: { apiKey: 'sk-1', accessToken: 't', prompt: 'do the thing', headers: { a: 1 }, ok: 1 },
      list: [{ webhookSecret: 's', keep: true }],
      password: 'p',
    })
    expect(cleaned).toEqual({
      changedFields: ['credentialRef', 'maxConcurrentRuns'],
      nested: { ok: 1 },
      list: [{ keep: true }],
    })
  })

  it('writes through the given client with sanitized details', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'evt-1' })
    await recordRuntimeBindingAudit(
      { runtimeBindingAuditEvent: { create } } as never,
      {
        bindingId: 'b-1',
        bindingRevision: 2,
        eventType: 'approved',
        actorUserId: 'admin-1',
        boardIds: ['board-1'],
        details: { selfApproval: true, credentialRef: 'cred:x' },
      },
    )
    expect(create).toHaveBeenCalledWith({
      data: {
        bindingId: 'b-1',
        bindingRevision: 2,
        eventType: 'approved',
        actorUserId: 'admin-1',
        actorPrincipal: null,
        boardIds: ['board-1'],
        repositoryRefs: [],
        reasonCode: null,
        details: { selfApproval: true },
        correlationId: null,
      },
    })
  })
})
