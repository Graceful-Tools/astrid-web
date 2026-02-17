import {
  AstridChannel,
  ChannelOAuthClient,
  ChannelRestClient,
  type AstridChannelConfig,
  type InboundMessage,
  type OutboundMessage,
} from '@gracefultools/astrid-sdk'

/**
 * OpenClaw channel plugin API surface.
 * Injected by the OpenClaw runtime when the plugin starts.
 */
export interface OpenClawChannelAPI {
  injectMessage(msg: InboundMessage): void
  log(level: 'info' | 'warn' | 'error', message: string): void
}

/**
 * Thin wrapper around the SDK's AstridChannel adapter,
 * conforming to OpenClaw's channel plugin lifecycle.
 */
export class AstridOpenClawChannel {
  private adapter: ReturnType<typeof AstridChannel.createAdapter> | null = null
  private rest: ChannelRestClient | null = null
  private config: AstridChannelConfig

  constructor(config: AstridChannelConfig) {
    this.config = config
  }

  /**
   * Initialize the SDK adapter and connect to Astrid SSE.
   * Messages are passed directly from the SDK — no reformatting.
   */
  async start(api: OpenClawChannelAPI): Promise<void> {
    this.adapter = AstridChannel.createAdapter(this.config)
    await this.adapter.init()

    // The SDK's connect() delivers pre-formatted InboundMessage objects
    // via taskToMessage() and commentToMessage() — just pass them through
    await this.adapter.connect((msg: InboundMessage) => {
      api.injectMessage(msg)
    })

    api.log('info', `Astrid channel connected (${this.adapter.getHealth().activeSessions} active sessions)`)
  }

  /**
   * Send a response back to Astrid.
   * For 'complete' action, post the comment then mark the task done.
   */
  async send(message: OutboundMessage, action?: string): Promise<void> {
    if (!this.adapter) {
      throw new Error('Astrid channel not started')
    }

    // Post the comment via the SDK adapter
    await this.adapter.send(message)

    // If completing, also mark the task as done via REST
    if (action === 'complete') {
      const taskId = message.sessionKey.replace('astrid:task:', '')
      if (taskId) {
        if (!this.rest) {
          const oauth = new ChannelOAuthClient(this.config)
          this.rest = new ChannelRestClient(this.config.apiBase, oauth)
        }
        await this.rest.completeTask(taskId)
      }
    }
  }

  /** Disconnect the SSE stream. */
  async stop(): Promise<void> {
    if (this.adapter) {
      await this.adapter.disconnect()
      this.adapter = null
    }
  }

  /** Health check delegated to the SDK adapter. */
  getStatus(): { connected: boolean; activeSessions: number } {
    if (!this.adapter) {
      return { connected: false, activeSessions: 0 }
    }
    return this.adapter.getHealth()
  }
}
