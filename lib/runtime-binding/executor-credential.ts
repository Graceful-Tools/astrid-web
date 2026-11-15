/**
 * The executor's view of a bound plan: its credential and payer references
 * (AWTD-1669).
 *
 * RFC docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §4: "Credential
 * retrieval is restricted to the selected executor/dispatcher, not queue
 * clients, list editors or audit readers." Outside the resolver and enrollment,
 * this is the ONLY module that reads `credentialRef` or the payer reference off
 * a plan; tests/rules/runtime-binding-credential-refs-stay-in-executor.test.ts
 * enforces that.
 *
 * In the polling pilot the executor path is the claim: the fence calls this
 * as its last check before granting a lease (RFC §5 step 4, "revalidate ... again
 * before credential use"). The references are never returned on the wire and
 * never audited. Jon's decision 4 (2026-11-14): business-provided credentials
 * or payer only, so a missing one is a denial. There is no personal key and no
 * deployment-hosted key to fall back to, and this module does not look for one.
 */

import { PILOT_BILLING_SOURCE } from '@/lib/runtime-binding/pilot'
import {
  deny,
  type RuntimeBindingDenial,
  type RuntimeBindingPlan,
} from '@/lib/ai/runtime-binding-resolver'

export interface ExecutorGrant {
  bindingId: string
  revision: number
  credentialRef: string
  payerAccountRef: string
}

export function executorGrantFor(plan: RuntimeBindingPlan): ExecutorGrant | RuntimeBindingDenial {
  if (!plan.credentialRef?.trim()) return deny(plan.bindingId, plan.boardId, 'credential-missing')
  if (plan.payer?.source !== PILOT_BILLING_SOURCE) return deny(plan.bindingId, plan.boardId, 'payer-not-business')
  if (!plan.payer.accountRef?.trim()) return deny(plan.bindingId, plan.boardId, 'payer-missing')
  return {
    bindingId: plan.bindingId,
    revision: plan.revision,
    credentialRef: plan.credentialRef,
    payerAccountRef: plan.payer.accountRef,
  }
}

export function isExecutorGrant(value: ExecutorGrant | RuntimeBindingDenial): value is ExecutorGrant {
  return !('kind' in value)
}
