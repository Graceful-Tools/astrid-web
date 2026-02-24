import type { AstridChannelConfig, InboundMessage, OutboundMessage } from './types.js'
import { OAuthClient } from './oauth-client.js'
import { RestClient } from './rest-client.js'
import { SSEClient } from './sse-client.js'
import { SessionMapper } from './session-mapper.js'
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
    const sse = new SSEClient(config, oauth)
    const sessions = new SessionMapper()

    return {
      async init(): Promise<void> {
        if (!config.clientId || !config.clientSecret) {
          throw new Error('Astrid channel: clientId and clientSecret are required')
        }
        await oauth.ensureToken()

        // Recover existing sessions
        const tasks = await rest.getAssignedTasks(false)
        for (const task of tasks) {
          sessions.getOrCreate(task.id)
        }
      },

      async connect(onMessage: (msg: InboundMessage) => void): Promise<void> {
        sse.on('task.assigned', (event) => {
          if (!event.data.task) return
          const taskId = event.data.taskId
          if (sessions.get(taskId)) return // Already has active session — skip duplicate
          const msg = taskToMessage(event.data.task)
          sessions.getOrCreate(taskId)
          onMessage(msg)
        })

        sse.on('task.commented', (event) => {
          const sessionKey = sessions.get(event.data.taskId)
          if (!sessionKey || !event.data.comment) return
          onMessage(commentToMessage(event.data.taskId, event.data.comment))
        })

        sse.on('task.completed', (event) => {
          sessions.end(event.data.taskId)
        })

        sse.on('task.deleted', (event) => {
          sessions.end(event.data.taskId)
        })

        await sse.connect()
      },

      async disconnect(): Promise<void> {
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
