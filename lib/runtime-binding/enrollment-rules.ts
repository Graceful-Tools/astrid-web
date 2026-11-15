/**
 * The pure rules of runtime-binding enrollment (AWTD-1668).
 *
 * Design: docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §6. No database
 * and no React, so the admin page and the server share them, and every rule is
 * testable on its own.
 *
 *  - The lifecycle: pending → verified → (approve) → active ⇄ suspended, and any
 *    live state → revoked, which is terminal. Only `active` gets work; the
 *    resolver (lib/ai/runtime-binding-resolver.ts) enforces that, not this file.
 *  - Which configuration changes BROADEN a binding. A broadening returns the
 *    binding to pending, needing approval again; a pure narrowing keeps it.
 *  - Input validation. Phase one is deployment-business scope only, and the
 *    reference fields are opaque ids, never a secret.
 */

import { z } from 'zod'
import {
  PILOT_BILLING_SOURCE,
  PILOT_MAX_CONCURRENT_RUNS,
  PILOT_SCOPE,
  PILOT_TRANSPORT,
} from '@/lib/runtime-binding/pilot'

export const RUNTIME_BINDING_STATES = ['pending', 'verified', 'active', 'suspended', 'revoked'] as const
export type RuntimeBindingState = (typeof RUNTIME_BINDING_STATES)[number]

export const RUNTIME_BINDING_ACTIONS = ['verify', 'approve', 'activate', 'suspend', 'revoke'] as const
export type RuntimeBindingAction = (typeof RUNTIME_BINDING_ACTIONS)[number]

/** Actions that stop a binding. Always allowed, even with enrollment gated off. */
export const STOPPING_ACTIONS: ReadonlySet<RuntimeBindingAction> = new Set(['suspend', 'revoke'])

export const RUNTIME_KINDS = ['user-machine', 'business-machine', 'astrid-hosted', 'provider-hosted'] as const
export const TRANSPORTS = ['polling', 'signed-webhook', 'provider-api', 'sse-channel', 'native-cloud-bridge'] as const
export const BILLING_SOURCES = ['personal-authorized', 'business-provided', 'deployment-hosted'] as const

/** The configuration a revision snapshots and an approval covers. */
export interface RuntimeBindingConfig {
  managementScope: string
  runtimeKind: string
  runtimeSubjectId: string
  runtimeCustodianUserId: string | null
  allowedAgentIds: string[]
  transport: string
  endpointRef: string | null
  credentialRef: string | null
  allowedRepositoryRefs: string[]
  allowedBoardIds: string[]
  maxConcurrentRuns: number
  billingSource: string
  billingAccountRef: string | null
}

export const CONFIG_FIELDS = [
  'managementScope',
  'runtimeKind',
  'runtimeSubjectId',
  'runtimeCustodianUserId',
  'allowedAgentIds',
  'transport',
  'endpointRef',
  'credentialRef',
  'allowedRepositoryRefs',
  'allowedBoardIds',
  'maxConcurrentRuns',
  'billingSource',
  'billingAccountRef',
] as const satisfies ReadonlyArray<keyof RuntimeBindingConfig>

type ConfigField = (typeof CONFIG_FIELDS)[number]

const SET_FIELDS = ['allowedAgentIds', 'allowedRepositoryRefs', 'allowedBoardIds'] as const
type SetField = (typeof SET_FIELDS)[number]
const isSetField = (field: ConfigField): field is SetField => (SET_FIELDS as readonly string[]).includes(field)

export function configOf(row: RuntimeBindingConfig): RuntimeBindingConfig {
  const out = {} as Record<ConfigField, unknown>
  for (const field of CONFIG_FIELDS) out[field] = row[field]
  return out as unknown as RuntimeBindingConfig
}

// ── Opaque references ────────────────────────────────────────────────────────

const OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/
const SECRET_SHAPED = /^(sk[-_]|pk[-_]|rk[-_]|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abprs]-|AKIA|ASIA|AIza|bearer|basic|eyJ)/i

/**
 * Is this an opaque reference id rather than a secret or a credentialed URL?
 * A reference names a record kept elsewhere ("cred:build-01:gen2"); it is never
 * the token, key, URL or payment detail itself.
 */
export function isOpaqueReference(value: string): boolean {
  if (!OPAQUE_REFERENCE.test(value)) return false
  if (value.includes('://')) return false
  return !SECRET_SHAPED.test(value)
}

// ── Input ────────────────────────────────────────────────────────────────────

const reference = z
  .string()
  .trim()
  .refine(isOpaqueReference, 'must be an opaque reference id, never a secret, token or URL')
const optionalReference = reference.nullable().optional()
const idSet = z
  .array(reference)
  .max(100)
  .transform(values => [...new Set(values)])

const configShape = {
  // Phase one: one business per deployment, no personal bindings (Jon, 2026-11-14).
  managementScope: z.literal(PILOT_SCOPE),
  runtimeKind: z.enum(RUNTIME_KINDS),
  runtimeSubjectId: reference,
  runtimeCustodianUserId: z.string().trim().min(1).nullable().optional(),
  allowedAgentIds: idSet,
  transport: z.enum(TRANSPORTS),
  endpointRef: optionalReference,
  credentialRef: optionalReference,
  allowedRepositoryRefs: idSet,
  allowedBoardIds: idSet,
  maxConcurrentRuns: z.number().int().positive().max(100),
  billingSource: z.enum(BILLING_SOURCES),
  billingAccountRef: optionalReference,
}

const createSchema = z
  .object({
    ...configShape,
    // A board-only binding may have no repositories (RFC §4); empty denies all.
    allowedRepositoryRefs: idSet.default([]),
    ownerUserId: z.string().trim().min(1).optional(),
  })
  .strict()

// No defaults here: an omitted field is unchanged, never reset.
const updateSchema = z.object(configShape).partial().strict()

export type CreateBindingInput = RuntimeBindingConfig & { ownerUserId?: string }

type Parsed<T> = { ok: true; value: T } | { ok: false; problems: string[] }

function problemsOf(error: z.ZodError): string[] {
  return error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`)
}

export function parseCreateInput(raw: unknown): Parsed<CreateBindingInput> {
  const result = createSchema.safeParse(raw)
  if (!result.success) return { ok: false, problems: problemsOf(result.error) }
  const v = result.data
  return {
    ok: true,
    value: {
      ...v,
      runtimeCustodianUserId: v.runtimeCustodianUserId ?? null,
      endpointRef: v.endpointRef ?? null,
      credentialRef: v.credentialRef ?? null,
      billingAccountRef: v.billingAccountRef ?? null,
    },
  }
}

export function parseUpdateInput(raw: unknown): Parsed<Partial<RuntimeBindingConfig>> {
  const result = updateSchema.safeParse(raw)
  if (!result.success) return { ok: false, problems: problemsOf(result.error) }
  return { ok: true, value: result.data as Partial<RuntimeBindingConfig> }
}

// ── Broadening ───────────────────────────────────────────────────────────────

/**
 * What changed between two configurations, and which of those changes widen
 * what the binding may do. Sets compare as sets: reordering is no change, and
 * a set broadens when the new one has any member the old one lacked (swapping
 * a board for another broadens; the new board was never approved). Every other
 * field broadens on any change: a different runtime, transport, endpoint,
 * credential, custodian or payer is a different agreement, not a smaller one.
 * Concurrency broadens only upward.
 */
export function classifyBindingChange(
  prev: RuntimeBindingConfig,
  next: RuntimeBindingConfig,
): { changed: ConfigField[]; broadened: ConfigField[] } {
  const changed: ConfigField[] = []
  const broadened: ConfigField[] = []
  for (const field of CONFIG_FIELDS) {
    if (isSetField(field)) {
      const before = new Set(prev[field])
      const after = new Set(next[field])
      const added = [...after].some(v => !before.has(v))
      const removed = [...before].some(v => !after.has(v))
      if (added || removed) changed.push(field)
      if (added) broadened.push(field)
    } else if (field === 'maxConcurrentRuns') {
      if (prev.maxConcurrentRuns !== next.maxConcurrentRuns) changed.push(field)
      if (next.maxConcurrentRuns > prev.maxConcurrentRuns) broadened.push(field)
    } else if ((prev[field] ?? null) !== (next[field] ?? null)) {
      changed.push(field)
      broadened.push(field)
    }
  }
  return { changed, broadened }
}

// ── Pilot limits ─────────────────────────────────────────────────────────────

export type PilotProblem =
  | 'scope-not-business'
  | 'transport-unsupported'
  | 'concurrency-invalid'
  | 'runtime-subject-missing'
  | 'credential-missing'
  | 'payer-not-business'
  | 'payer-missing'
  | 'agents-empty'
  | 'boards-empty'

/**
 * Why the resolver would deny this configuration, using the resolver's own
 * limits. Verification refuses a binding that could never run.
 */
export function pilotConfigurationProblems(config: RuntimeBindingConfig): PilotProblem[] {
  const problems: PilotProblem[] = []
  if (config.managementScope !== PILOT_SCOPE) problems.push('scope-not-business')
  if (config.transport !== PILOT_TRANSPORT) problems.push('transport-unsupported')
  if (config.maxConcurrentRuns !== PILOT_MAX_CONCURRENT_RUNS) problems.push('concurrency-invalid')
  if (!config.runtimeSubjectId?.trim()) problems.push('runtime-subject-missing')
  if (!config.credentialRef?.trim()) problems.push('credential-missing')
  if (config.billingSource !== PILOT_BILLING_SOURCE) problems.push('payer-not-business')
  if (!config.billingAccountRef?.trim()) problems.push('payer-missing')
  if (config.allowedAgentIds.length === 0) problems.push('agents-empty')
  if (config.allowedBoardIds.length === 0) problems.push('boards-empty')
  return problems
}

// ── Snapshots ────────────────────────────────────────────────────────────────

/** Canonical snapshot of a configuration: sets sorted, nulls explicit. */
export function snapshotOf(config: RuntimeBindingConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of CONFIG_FIELDS) {
    const value = config[field]
    out[field] = isSetField(field) ? [...(value as string[])].sort() : value ?? null
  }
  return out
}

export function snapshotsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map(key => [key, canonical((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export interface LifecycleView {
  state: string
  revision: number
  approvedRevision: number | null
  approvedBy: string | null
}

export type TransitionPlan =
  | { ok: true; to: RuntimeBindingState }
  | { ok: false; code: 'transition-not-allowed' | 'revision-unapproved' | 'already-approved'; message: string }

const isApproved = (b: LifecycleView) => !!b.approvedBy && b.approvedRevision === b.revision

/** The next state for an action, or why the action is not allowed now. */
export function planTransition(binding: LifecycleView, action: RuntimeBindingAction): TransitionPlan {
  const notAllowed = (): TransitionPlan => ({
    ok: false,
    code: 'transition-not-allowed',
    message: `A ${binding.state} runtime binding cannot be sent "${action}".`,
  })
  const state = binding.state

  switch (action) {
    case 'verify':
      return state === 'pending' ? { ok: true, to: 'verified' } : notAllowed()
    case 'approve':
      if (state !== 'verified') return notAllowed()
      if (isApproved(binding)) {
        return { ok: false, code: 'already-approved', message: `Revision ${binding.revision} is already approved.` }
      }
      return { ok: true, to: 'verified' }
    case 'activate':
      if (state !== 'verified' && state !== 'suspended') return notAllowed()
      if (!isApproved(binding)) {
        return {
          ok: false,
          code: 'revision-unapproved',
          message: `Revision ${binding.revision} has not been approved, so the binding cannot be activated.`,
        }
      }
      return { ok: true, to: 'active' }
    case 'suspend':
      return state === 'active' ? { ok: true, to: 'suspended' } : notAllowed()
    case 'revoke':
      return state === 'revoked' ? notAllowed() : { ok: true, to: 'revoked' }
  }
}

/** The actions that are legal right now, in lifecycle order. */
export function availableActions(binding: LifecycleView): RuntimeBindingAction[] {
  return RUNTIME_BINDING_ACTIONS.filter(action => planTransition(binding, action).ok)
}
