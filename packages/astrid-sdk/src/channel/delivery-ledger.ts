import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

interface DeliveryState {
  version: 1
  scope: string
  entries: { key: string; serverTime?: number }[]
  lastServerTime?: number
}

const MAX_ENTRIES = 1000
const MAX_AGE_MS = 30 * 24 * 60 * 60_000

/** Bounded task-id ledger; no wall-clock expiry that can forget work on clock skew. */
export class DeliveryLedger {
  private state: DeliveryState
  private file: string

  constructor(file: string, apiBase: string, clientId: string, mailbox: string) {
    if (!file.trim()) throw new Error('Astrid recovery: stateFile must not be empty')
    this.file = resolve(file)
    const scope = createHash('sha256').update(JSON.stringify([apiBase, clientId, mailbox])).digest('hex')
    this.state = { version: 1, scope, entries: [] }
    let raw: string
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const parsed: unknown = JSON.parse(raw)
    if (!this.validState(parsed) || parsed.scope !== scope) {
      throw new Error('Astrid recovery: invalid ledger or different agent scope')
    }
    this.state = parsed
  }

  private validState(value: unknown): value is DeliveryState {
    if (!value || typeof value !== 'object') return false
    const state = value as Partial<DeliveryState>
    return state.version === 1 && typeof state.scope === 'string'
      && Array.isArray(state.entries)
      && state.entries.length <= MAX_ENTRIES
      && state.entries.every(entry => entry && typeof entry.key === 'string'
        && /^(task|comment|pending):.+$/.test(entry.key)
        && (entry.serverTime === undefined || (typeof entry.serverTime === 'number'
          && Number.isFinite(entry.serverTime) && entry.serverTime >= 0)))
      && (state.lastServerTime === undefined
        || (typeof state.lastServerTime === 'number' && Number.isFinite(state.lastServerTime) && state.lastServerTime >= 0))
  }

  has(taskId: string): boolean {
    return this.state.entries.some(entry => entry.key === `task:${taskId}`)
  }

  hasComment(commentId: string): boolean {
    return this.state.entries.some(entry => entry.key === `comment:${commentId}`)
  }

  get lastServerTime(): number | undefined {
    return this.state.lastServerTime
  }

  deliveredTaskIds(): string[] {
    return this.state.entries.filter(entry => entry.key.startsWith('task:'))
      .map(entry => entry.key.slice('task:'.length))
  }

  delivered(taskId: string, commentIds: string[] = []): void {
    if (this.has(taskId)) return
    this.record([`task:${taskId}`, ...commentIds.map(id => `comment:${id}`)], `pending:${taskId}`)
  }

  pendingTaskIds(): string[] {
    return this.state.entries.filter(entry => entry.key.startsWith('pending:'))
      .map(entry => entry.key.slice('pending:'.length))
  }

  begin(taskId: string): void {
    const key = `pending:${taskId}`
    if (this.state.entries.some(entry => entry.key === key)) return
    this.record([key])
  }

  commented(commentId: string): void {
    if (this.hasComment(commentId)) return
    this.record([`comment:${commentId}`])
  }

  private record(keys: string[], replaceKey?: string): void {
    const entries = [
      ...this.state.entries.filter(entry => entry.key !== replaceKey && !keys.includes(entry.key)),
      ...keys.map(key => ({ key })),
    ]
    if (entries.length > MAX_ENTRIES) {
      console.warn('Astrid recovery: delivery ledger capacity exceeded; oldest task may be delivered again')
    }
    this.save({ ...this.state, entries: entries.slice(-MAX_ENTRIES) })
  }

  end(taskId: string): void {
    const entries = this.state.entries.filter(entry => entry.key !== `task:${taskId}` && entry.key !== `pending:${taskId}`)
    if (entries.length === this.state.entries.length) return
    this.save({ ...this.state, entries })
  }

  observeServerTime(time: number): void {
    const entries = this.state.entries
      .map(entry => ({ ...entry, serverTime: entry.serverTime ?? time }))
      .filter(entry => time - entry.serverTime < MAX_AGE_MS)
    if (entries.length < this.state.entries.length) {
      console.warn('Astrid recovery: delivery ledger age limit reached; old work may be delivered again')
    }
    this.save({ ...this.state, entries, lastServerTime: time })
  }

  restoreServerTime(time: number | undefined): void {
    this.save({ ...this.state, lastServerTime: time })
  }

  private save(state: DeliveryState): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.file)
      this.state = state
    } finally {
      try {
        unlinkSync(temporary)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}
