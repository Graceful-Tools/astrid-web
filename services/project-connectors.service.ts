/**
 * A project's connectors to outside services (ADEV-277, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → The
 * model → 3. Connectors). Shared by app/api/v1/projects/[id]/connectors and the poll job.
 *
 * Who may do what: only the project's owner or an admin creates, edits, tests, lists or removes a
 * connector (`canUserManageProject`). Agents never do: a connector decides where a goal's number
 * comes from, so an agent that could bind one could write its own score. A person with no part in the
 * project gets a 404, never a 403, so the route does not confirm the project exists.
 *
 * The credential is encrypted (`encryptField`) and never returned by anything here: a view says only
 * `hasCredential`. A service from the environment's registry (`ASTRID_SIGNAL_SERVICES`) takes its
 * credential from the variable the registry names, so it is never stored at all.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canUserManageProject, getUserRoleInProject } from '@/lib/list-permissions'
import { decryptField, encryptField } from '@/lib/field-encryption'
import { explicitlyEnabled } from '@/lib/brand/capabilities'
import { assertPublicOutboundUrl, OutboundUrlError } from '@/lib/security/outbound-url'
import { parseSignalServices, SIGNAL_SERVICE_KINDS, type SignalServiceKind } from '@/lib/goal-signal-services'
import { queryMetricSource, type MetricQueryResult, type MetricSourceTarget } from '@/lib/goal-signals-metric-source'

export type ConnectorsResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404; error: string }

export const CUSTOM_SERVICE_KEY = 'custom'
export const CONNECTOR_NAME_MAX_CHARS = 80
export const CONNECTORS_PER_PROJECT_MAX = 20
const CREDENTIAL_MAX_CHARS = 2000
const ENDPOINT_MAX_CHARS = 500
/** A failure's text is kept short: it is shown in settings and comes from a stranger's service. */
const LAST_ERROR_MAX_CHARS = 300

export interface ConnectorView {
  id: string
  projectId: string
  kind: SignalServiceKind
  serviceKey: string
  name: string
  /** Only a custom connector has one. */
  endpointUrl: string | null
  /** True when a credential is stored. The credential itself is never returned. */
  hasCredential: boolean
  state: string
  lastOkAt: string | null
  lastError: string | null
  createdAt: string
}

interface ConnectorRow {
  id: string
  projectId: string
  kind: string
  serviceKey: string
  name: string
  endpointUrl: string | null
  credentialEnc: string | null
  config: unknown
  state: string
  lastOkAt: Date | null
  lastError: string | null
  lastPolledAt: Date | null
  createdAt: Date
}

export function connectorView(row: ConnectorRow): ConnectorView {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as SignalServiceKind,
    serviceKey: row.serviceKey,
    name: row.name,
    endpointUrl: row.endpointUrl,
    hasCredential: !!row.credentialEnc || (row.serviceKey !== CUSTOM_SERVICE_KEY && registryCredential(row.serviceKey) !== null),
    state: row.state,
    lastOkAt: row.lastOkAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  }
}

function registryService(key: string, kind?: string) {
  return parseSignalServices(process.env.ASTRID_SIGNAL_SERVICES).find(s => s.key === key && (!kind || s.kind === kind))
}

/** The credential the environment holds for a registry service, or null. */
function registryCredential(key: string): string | null {
  const service = registryService(key)
  if (!service) return null
  const value = process.env[service.secretEnv]
  return value?.trim() ? value.trim() : null
}

/**
 * Where to call and with what, for a stored connector. Null `error` means the target is usable.
 * Shared by the test route and the poll job so both read the connector the same way.
 */
export function metricTargetFor(
  row: Pick<ConnectorRow, 'serviceKey' | 'endpointUrl' | 'credentialEnc' | 'kind'>,
): { target: MetricSourceTarget; error: null } | { target: null; error: string } {
  return sourceTargetFor(row, 'metric')
}

/** The same, for a connector of any kind: the experiment source reads its coordinates the same way (ADEV-279). */
export function sourceTargetFor(
  row: Pick<ConnectorRow, 'serviceKey' | 'endpointUrl' | 'credentialEnc' | 'kind'>,
  kind: SignalServiceKind,
): { target: MetricSourceTarget; error: null } | { target: null; error: string } {
  if (row.kind !== kind) return { target: null, error: `This connector is not a ${kind} source` }
  if (row.serviceKey === CUSTOM_SERVICE_KEY) {
    if (!explicitlyEnabled(process.env.ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS)) {
      return { target: null, error: 'Custom endpoints are not enabled in this deployment' }
    }
    if (!row.endpointUrl) return { target: null, error: 'The connector has no endpoint' }
    return { target: { baseUrl: row.endpointUrl, credential: decryptField(row.credentialEnc), userSuppliedUrl: true }, error: null }
  }
  const service = registryService(row.serviceKey, kind)
  if (!service) return { target: null, error: 'This service is no longer defined by the environment' }
  return { target: { baseUrl: service.baseUrl, credential: registryCredential(row.serviceKey), userSuppliedUrl: false }, error: null }
}

const PROJECT_SELECT = { id: true, ownerId: true, members: { select: { userId: true, role: true } } } as const

/** The project for a manager, or the result to return: 404 for an outsider, 403 for a plain member. */
async function projectForManager(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT })
  if (!project || !getUserRoleInProject({ id: userId }, project)) return { fail: { ok: false as const, status: 404 as const, error: 'Project not found' } }
  if (!canUserManageProject({ id: userId }, project)) {
    return { fail: { ok: false as const, status: 403 as const, error: "Only the project owner or an admin can manage its connectors" } }
  }
  return { project }
}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t.slice(0, max) : undefined
}

async function checkEndpoint(raw: string): Promise<string | null> {
  if (raw.length > ENDPOINT_MAX_CHARS) return `The endpoint is at most ${ENDPOINT_MAX_CHARS} characters`
  try {
    await assertPublicOutboundUrl(raw)
    return null
  } catch (error) {
    return error instanceof OutboundUrlError ? error.message : 'The endpoint is not allowed'
  }
}

export async function listConnectors(projectId: string, userId: string): Promise<ConnectorsResult<{ connectors: ConnectorView[] }>> {
  const loaded = await projectForManager(projectId, userId)
  if (loaded.fail) return loaded.fail
  const rows = await prisma.projectConnector.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } })
  return { ok: true, value: { connectors: rows.map(connectorView) } }
}

/** `{ kind, serviceKey, name, endpointUrl?, credential? }` — `serviceKey` is a registry key or "custom". */
export async function createConnector(projectId: string, userId: string, body: unknown): Promise<ConnectorsResult<ConnectorView>> {
  const loaded = await projectForManager(projectId, userId)
  if (loaded.fail) return loaded.fail
  const input = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>

  if (!SIGNAL_SERVICE_KINDS.includes(input.kind as SignalServiceKind)) {
    return { ok: false, status: 400, error: `kind is one of ${SIGNAL_SERVICE_KINDS.join(', ')}` }
  }
  const kind = input.kind as SignalServiceKind
  const serviceKey = text(input.serviceKey, 80)
  if (!serviceKey) return { ok: false, status: 400, error: 'serviceKey names a service from the environment, or "custom"' }

  let endpointUrl: string | null = null
  let credentialEnc: string | null = null
  let defaultName: string
  if (serviceKey === CUSTOM_SERVICE_KEY) {
    if (!explicitlyEnabled(process.env.ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS)) {
      return { ok: false, status: 400, error: 'Custom endpoints are not enabled in this deployment' }
    }
    const url = text(input.endpointUrl, ENDPOINT_MAX_CHARS + 1)
    if (!url) return { ok: false, status: 400, error: 'A custom connector needs an endpointUrl' }
    const problem = await checkEndpoint(url)
    if (problem) return { ok: false, status: 400, error: problem }
    endpointUrl = url
    const credential = text(input.credential, CREDENTIAL_MAX_CHARS)
    if (credential) credentialEnc = encryptField(credential)
    defaultName = new URL(url).hostname
  } else {
    const service = registryService(serviceKey, kind)
    if (!service) return { ok: false, status: 400, error: `No ${kind} service "${serviceKey}" is defined by the environment` }
    if (input.endpointUrl !== undefined || input.credential !== undefined) {
      return { ok: false, status: 400, error: 'A service from the environment takes no endpointUrl or credential' }
    }
    defaultName = service.name
  }

  const name = text(input.name, CONNECTOR_NAME_MAX_CHARS) ?? defaultName
  const count = await prisma.projectConnector.count({ where: { projectId } })
  if (count >= CONNECTORS_PER_PROJECT_MAX) return { ok: false, status: 400, error: `At most ${CONNECTORS_PER_PROJECT_MAX} connectors per project` }

  const row = await prisma.projectConnector.create({
    data: { projectId, kind, serviceKey, name, endpointUrl, credentialEnc, createdById: userId },
  })
  return { ok: true, value: connectorView(row) }
}

/** `{ name?, endpointUrl?, credential? }` — `credential: null` removes the stored one. */
export async function updateConnector(
  projectId: string,
  connectorId: string,
  userId: string,
  body: unknown,
): Promise<ConnectorsResult<ConnectorView>> {
  const loaded = await projectForManager(projectId, userId)
  if (loaded.fail) return loaded.fail
  const row = await prisma.projectConnector.findFirst({ where: { id: connectorId, projectId } })
  if (!row) return { ok: false, status: 404, error: 'Connector not found' }
  const input = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>

  const data: { name?: string; endpointUrl?: string; credentialEnc?: string | null; state?: string; lastError?: null } = {}
  if (input.name !== undefined) {
    const name = text(input.name, CONNECTOR_NAME_MAX_CHARS)
    if (!name) return { ok: false, status: 400, error: 'name cannot be empty' }
    data.name = name
  }
  const custom = row.serviceKey === CUSTOM_SERVICE_KEY
  if (input.endpointUrl !== undefined || input.credential !== undefined) {
    if (!custom) return { ok: false, status: 400, error: 'A service from the environment takes no endpointUrl or credential' }
  }
  if (input.endpointUrl !== undefined) {
    const url = text(input.endpointUrl, ENDPOINT_MAX_CHARS + 1)
    if (!url) return { ok: false, status: 400, error: 'endpointUrl cannot be empty' }
    const problem = await checkEndpoint(url)
    if (problem) return { ok: false, status: 400, error: problem }
    data.endpointUrl = url
  }
  if (input.credential !== undefined) {
    if (input.credential === null) data.credentialEnc = null
    else {
      const credential = text(input.credential, CREDENTIAL_MAX_CHARS)
      if (!credential) return { ok: false, status: 400, error: 'credential is a string, or null to remove it' }
      data.credentialEnc = encryptField(credential)
    }
  }
  if (data.endpointUrl !== undefined || data.credentialEnc !== undefined) {
    // New coordinates start clean: the old failure was about the old ones.
    data.state = 'ok'
    data.lastError = null
  }
  const updated = await prisma.projectConnector.update({ where: { id: row.id }, data })
  return { ok: true, value: connectorView(updated) }
}

export async function deleteConnector(projectId: string, connectorId: string, userId: string): Promise<ConnectorsResult<{ deleted: true }>> {
  const loaded = await projectForManager(projectId, userId)
  if (loaded.fail) return loaded.fail
  const { count } = await prisma.projectConnector.deleteMany({ where: { id: connectorId, projectId } })
  if (!count) return { ok: false, status: 404, error: 'Connector not found' }
  return { ok: true, value: { deleted: true } }
}

/** What a failed call is recorded as, kept short and plain. */
export function connectorFailureText(error: string): string {
  return error.replace(/\s+/g, ' ').trim().slice(0, LAST_ERROR_MAX_CHARS)
}

/** Record how a call went on the connector row. `retryNotBefore` is honoured by the poll job. */
export async function recordConnectorOutcome(
  connectorId: string,
  result: { ok: true } | { ok: false; error: string; retryAfterSeconds?: number },
  now: Date,
): Promise<void> {
  if (result.ok) {
    await prisma.projectConnector.update({
      where: { id: connectorId },
      data: { state: 'ok', lastOkAt: now, lastError: null, lastPolledAt: now, config: Prisma.DbNull },
    })
    return
  }
  const retryNotBefore = result.retryAfterSeconds !== undefined ? new Date(now.getTime() + result.retryAfterSeconds * 1000).toISOString() : null
  await prisma.projectConnector.update({
    where: { id: connectorId },
    data: {
      state: 'error',
      lastError: connectorFailureText(result.error),
      lastPolledAt: now,
      ...(retryNotBefore ? { config: { retryNotBefore } } : {}),
    },
  })
}

/** The connector's `retryNotBefore`, when a 429 told the poll job to wait. */
export function retryNotBefore(config: unknown): Date | null {
  const raw = config && typeof config === 'object' ? (config as Record<string, unknown>).retryNotBefore : null
  const when = typeof raw === 'string' ? Date.parse(raw) : NaN
  return Number.isNaN(when) ? null : new Date(when)
}

export interface ConnectorTestView {
  ok: boolean
  error: string | null
  /** What the service said about the key that was asked for, when one was. */
  reading: { key: string; status: string; value?: number; unit?: string; at?: string } | null
  connector: ConnectorView
}

/** `{ metricKey? }` — call the service once and record how it went. With no key, only reachability is tested. */
export async function testConnector(
  projectId: string,
  connectorId: string,
  userId: string,
  body: unknown,
  fetchImpl?: typeof fetch,
): Promise<ConnectorsResult<ConnectorTestView>> {
  const loaded = await projectForManager(projectId, userId)
  if (loaded.fail) return loaded.fail
  const row = await prisma.projectConnector.findFirst({ where: { id: connectorId, projectId } })
  if (!row) return { ok: false, status: 404, error: 'Connector not found' }
  if (row.kind !== 'metric') return { ok: false, status: 400, error: 'Only a metric connector can be tested so far' }
  const input = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>
  const metricKey = input.metricKey === undefined ? undefined : text(input.metricKey, 120)
  if (input.metricKey !== undefined && !metricKey) return { ok: false, status: 400, error: 'metricKey is a non-empty string' }

  const now = new Date()
  const built = metricTargetFor(row)
  const result: MetricQueryResult = built.target
    ? await queryMetricSource(built.target, metricKey ? [{ key: metricKey }] : [], { fetchImpl })
    : { ok: false, kind: 'client', error: built.error }
  await recordConnectorOutcome(row.id, result, now)
  const fresh = (await prisma.projectConnector.findUnique({ where: { id: row.id } })) ?? row
  const reading = result.ok && metricKey ? result.readings.find(r => r.key === metricKey) ?? null : null
  return {
    ok: true,
    value: {
      ok: result.ok,
      error: result.ok ? null : connectorFailureText(result.error),
      reading: reading ? { key: reading.key, status: reading.status, value: reading.value, unit: reading.unit, at: reading.at } : null,
      connector: connectorView(fresh),
    },
  }
}
