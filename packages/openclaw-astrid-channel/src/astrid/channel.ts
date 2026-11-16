import type { AgentComment, AgentTask, AstridChannelConfig, InboundMessage, OutboundMessage } from './types.js'
import { resolveApiBase } from './api-base.js'
import { OAuthClient } from './oauth-client.js'
import { RestClient } from './rest-client.js'
import { SSEClient } from './sse-client.js'
import { SessionMapper } from './session-mapper.js'
import { DeliveryLedger } from './delivery-ledger.js'
import { taskToMessage, commentToMessage, responseToComment } from './message-formatter.js'

/** Replay window the server's event buffer is assumed to retain. */
const REPLAY_RETENTION_MS = 15 * 60_000
/** Time after `connected` before a keepalive may advance the replay cursor. */
const REPLAY_SETTLE_MS = 30_000
/** Overlap subtracted from the persisted cursor when reconnecting. */
const REPLAY_OVERLAP_MS = 30_000

/**
 * Astrid channel plugin for OpenClaw.
 */
export const astridChannel = {
  id: 'astrid' as const,

  meta: {
    id: 'astrid',
    label: 'Astrid',
    selectionLabel: 'Astrid.cc',
    docsPath: '/channels/astrid',
    blurb: 'Task management',
  },

  capabilities: {
    chatTypes: ['direct'] as const,
    media: false,
    reactions: false,
    edit: false,
    polls: false,
  },

  createAdapter(config: AstridChannelConfig) {
    const oauth = new OAuthClient(config)
    const rest = new RestClient(config.apiBase, oauth)
    const sessions = new SessionMapper()
    const mailbox = config.recovery?.agentMailbox?.trim() ?? ''
    if (config.recovery && !mailbox) throw new Error('Astrid recovery: agentMailbox is required')
    const ledger = config.recovery
      ? new DeliveryLedger(config.recovery.stateFile, resolveApiBase(config.apiBase), config.clientId, mailbox)
      : undefined
    let onMessage: ((msg: InboundMessage) => void) | undefined
    let handlersRegistered = false
    let disconnected = false
    // Server time of the current connection's `connected` event (recovery only).
    let connectedAt: number | undefined

    const deliver = async (task: AgentTask, action: 'claim' | 'resume' = 'claim'): Promise<boolean> => {
      if (ledger && task.completed) {
        ledger.end(task.id)
        return false
      }
      if (disconnected || !onMessage) return false
      if (ledger ? ledger.has(task.id) : sessions.get(task.id)) {
        sessions.getOrCreate(task.id)
        return false
      }
      ledger?.begin(task.id)
      if (ledger && !await rest.claimTask(task.id, action, mailbox)) {
        ledger.end(task.id)
        return false
      }
      if (disconnected) return false
      sessions.getOrCreate(task.id)
      try {
        const accepted = onMessage(taskToMessage(task))
        await accepted
        ledger?.delivered(task.id, task.comments.map(comment => comment.id))
        return true
      } catch (error) {
        // Recovery retries an unaccepted task, so it must not keep a session.
        // The legacy path keeps it, exactly as before recovery existed: later
        // comments still arrive and send() still works (AWTD-1565 review).
        if (ledger) sessions.end(task.id)
        throw error
      }
    }

    const deliverComment = async (taskId: string, comment: AgentComment): Promise<void> => {
      if (disconnected || !onMessage || ledger?.hasComment(taskId, comment.id)) return
      sessions.getOrCreate(taskId)
      const accepted = onMessage(commentToMessage(taskId, comment))
      await accepted
      ledger?.commented(taskId, comment.id)
    }

    const sse = new SSEClient(config, oauth, ledger ? {
      since: () => Math.max(1, (ledger.lastServerTime ?? 1) - REPLAY_OVERLAP_MS),
      onConnected: async () => {
        connectedAt = undefined // set by this connection's `connected` event
        const seen = new Set<string>()
        for (const id of ledger.pendingTaskIds()) {
          const task = await rest.getPendingTask(id)
          if (!task) {
            ledger.end(id)
            continue
          }
          if (await deliver(task, 'resume')) {
            seen.add(id)
          }
        }
        const lists = config.lists?.length ? config.lists : [undefined]
        for (const listId of lists) {
          const queue = await rest.getRecoveryQueue(mailbox, listId)
          for (const entry of queue.queue) {
            if (seen.has(entry.id)) continue
            seen.add(entry.id)
            const task = await rest.getPendingTask(entry.id)
            if (task) await deliver(task)
          }
          for (const entry of queue.attention.tasks) {
            if (ledger.hasComment(entry.id, entry.lastComment.id)) continue
            const task = await rest.getPendingTask(entry.id)
            if (!task) continue
            if (!entry.completed && !ledger.has(entry.id)) {
              if (!await deliver(task, entry.statusRole === 'ready' ? 'claim' : 'resume')) continue
              ledger.commented(entry.id, entry.lastComment.id)
            } else {
              const comment = task.comments.find(comment => comment.id === entry.lastComment.id)
              if (!comment) throw new Error('Astrid recovery: attention comment missing from task response')
              await deliverComment(entry.id, comment)
            }
          }
        }
      },
      onServerTime: (time, kind) => {
        if (kind === 'connected') {
          connectedAt = time
          if (ledger.lastServerTime !== undefined && time - ledger.lastServerTime >= REPLAY_RETENTION_MS) {
            console.warn('Astrid recovery: replay retention gap detected; reconciled assigned tasks from queue')
          }
          return
        }
        // The cursor moves only here, on a keepalive: the SSE client dispatches
        // it after every event read before it was accepted (or recorded by the
        // ledger), so a crash never leaves the cursor past unaccepted work.
        // `connected` is not such a point, because the server replays missed
        // events after it, asynchronously. Hold the cursor until the replay has
        // had REPLAY_SETTLE_MS to drain, so a keepalive interleaved with a slow
        // replay cannot skip the rest of it.
        if (connectedAt === undefined || time - connectedAt < REPLAY_SETTLE_MS) return
        ledger.observeServerTime(time)
      },
    } : undefined)

    return {
      async init(): Promise<void> {
        if (!config.clientId || !config.clientSecret) {
          throw new Error('Astrid channel: clientId and clientSecret are required')
        }
        await oauth.ensureToken()

        // Recover existing sessions
        if (ledger) {
          for (const id of ledger.deliveredTaskIds()) sessions.getOrCreate(id)
        } else {
          const tasks = await rest.getAssignedTasks(false)
          for (const task of tasks) {
            sessions.getOrCreate(task.id)
          }
        }
      },

      async connect(handler: (msg: InboundMessage) => void): Promise<void> {
        onMessage = handler
        disconnected = false
        if (!handlersRegistered) {
          sse.on('task.assigned', async (event) => {
            if (event.data.task) await deliver(event.data.task)
          })

          sse.on('task.commented', async (event) => {
            const sessionKey = sessions.get(event.data.taskId)
            if (!sessionKey || !event.data.comment || disconnected) return
            await deliverComment(event.data.taskId, event.data.comment)
          })

          const endSession = async (taskId: string): Promise<void> => {
            if (ledger) {
              // A replayed terminal event may precede the Ready snapshot just accepted.
              const current = await rest.getPendingTask(taskId)
              if (current && !current.completed) return
              ledger.end(taskId)
            }
            sessions.end(taskId)
          }
          sse.on('task.completed', event => endSession(event.data.taskId))
          sse.on('task.deleted', event => endSession(event.data.taskId))
          handlersRegistered = true
        }

        await sse.connect()
      },

      async disconnect(): Promise<void> {
        disconnected = true
        sse.disconnect()
      },

      async send(msg: OutboundMessage): Promise<void> {
        const taskId = sessions.getTaskId(msg.sessionKey)
        if (!taskId) {
          throw new Error(`No Astrid task mapped to session ${msg.sessionKey}`)
        }
        const content = responseToComment(msg)
        await rest.postComment(taskId, content)
      },

      isConnected(): boolean {
        return sse.isConnected()
      },

      getHealth() {
        return {
          connected: sse.isConnected(),
          activeSessions: sessions.activeCount(),
        }
      },
    }
  },
}
