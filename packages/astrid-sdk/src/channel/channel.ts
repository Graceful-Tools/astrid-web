import type { AgentComment, AgentTask, AstridChannelConfig, InboundMessage, OutboundMessage } from './types.js'
import { resolveApiBase } from '../config/api-base.js'
import { OAuthClient } from './oauth-client.js'
import { RestClient } from './rest-client.js'
import { SSEClient } from './sse-client.js'
import { SessionMapper } from './session-mapper.js'
import { DeliveryLedger } from './delivery-ledger.js'
import { taskToMessage, commentToMessage, responseToComment } from './message-formatter.js'

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
        if (ledger) await accepted
        ledger?.delivered(task.id, task.comments.map(comment => comment.id))
        return true
      } catch (error) {
        sessions.end(task.id)
        throw error
      }
    }

    const deliverComment = async (taskId: string, comment: AgentComment): Promise<void> => {
      if (disconnected || !onMessage || ledger?.hasComment(comment.id)) return
      sessions.getOrCreate(taskId)
      const accepted = onMessage(commentToMessage(taskId, comment))
      if (ledger) await accepted
      ledger?.commented(comment.id)
    }

    const sse = new SSEClient(config, oauth, ledger ? {
      since: () => Math.max(0, (ledger.lastServerTime ?? 0) - 30_000),
      onConnected: async () => {
        const seen = new Set<string>()
        const newlyDelivered = new Set<string>()
        for (const id of ledger.pendingTaskIds()) {
          const task = await rest.getPendingTask(id)
          if (!task) {
            ledger.end(id)
            continue
          }
          if (await deliver(task, 'resume')) {
            newlyDelivered.add(id)
            seen.add(id)
          }
        }
        const lists = config.lists?.length ? config.lists : [undefined]
        for (const listId of lists) {
          const queue = await rest.getRecoveryQueue(mailbox, listId)
          for (const entry of queue.queue) {
            if (seen.has(entry.id)) continue
            seen.add(entry.id)
            const task = await rest.getTask(entry.id)
            if (await deliver(task)) newlyDelivered.add(entry.id)
          }
          for (const entry of queue.attention.tasks) {
            if (ledger.hasComment(entry.lastComment.id)) continue
            if (newlyDelivered.has(entry.id)) {
              ledger.commented(entry.lastComment.id)
              continue
            }
            const task = await rest.getTask(entry.id)
            if (!entry.completed && !ledger.has(entry.id)) {
              if (!await deliver(task, entry.statusRole === 'ready' ? 'claim' : 'resume')) continue
              ledger.commented(entry.lastComment.id)
            } else {
              const comment = task.comments.find(comment => comment.id === entry.lastComment.id)
              if (!comment) throw new Error('Astrid recovery: attention comment missing from task response')
              await deliverComment(entry.id, comment)
            }
          }
        }
      },
      onServerTime: time => {
        if (ledger.lastServerTime !== undefined && time - ledger.lastServerTime >= 15 * 60_000) {
          console.warn('Astrid recovery: replay retention gap detected; reconciled assigned tasks from queue')
        }
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

          sse.on('task.completed', (event) => {
            sessions.end(event.data.taskId)
            ledger?.end(event.data.taskId)
          })

          sse.on('task.deleted', (event) => {
            sessions.end(event.data.taskId)
            ledger?.end(event.data.taskId)
          })
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
