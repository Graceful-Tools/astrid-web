/**
 * Astrid.cc Channel Plugin for OpenClaw (Legacy standalone class)
 *
 * Kept for backward compatibility with programmatic users who import
 * AstridChannelPlugin directly. New integrations should use the default
 * export (OpenClawPluginDefinition) from the package root.
 */

import { AstridChannel as SDKChannel } from '@gracefultools/astrid-sdk';
import type { AstridChannelConfig } from './types.js';

/** Legacy plugin API shape (v1 compat) */
export interface LegacyChannelAPI {
  getConfig<T = any>(key?: string): T;
  injectMessage(message: LegacyInboundMessage): Promise<void>;
  onOutbound(handler: (message: LegacyOutboundMessage) => Promise<void>): void;
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, any>): void;
  registerCommand(name: string, handler: (args: string[]) => Promise<void>): void;
}

export interface LegacyInboundMessage {
  channel: 'astrid';
  sessionKey: string;
  content: string;
  from: string;
  fromName?: string;
  timestamp?: string;
  metadata?: {
    taskId: string;
    type: 'task' | 'comment';
    listName?: string;
    listDescription?: string;
    priority?: number;
    dueDateTime?: string;
    [key: string]: any;
  };
}

export interface LegacyOutboundMessage {
  channel: 'astrid';
  sessionKey: string;
  content: string;
  target?: string;
  action?: 'send' | 'complete' | 'update';
  metadata?: {
    taskId?: string;
    updates?: {
      completed?: boolean;
      title?: string;
      description?: string;
      priority?: number;
    };
  };
}

export class AstridChannelPlugin {
  private api: LegacyChannelAPI | null = null;
  private config: AstridChannelConfig | null = null;
  private adapter: any = null;
  private sessionMap = new Map<string, string>();

  async init(api: LegacyChannelAPI): Promise<void> {
    this.api = api;
    this.config = api.getConfig<AstridChannelConfig>();

    if (!this.config?.enabled) {
      api.log('info', 'Astrid channel disabled in config');
      return;
    }

    if (!this.config.clientId || !this.config.clientSecret) {
      api.log('error', 'Astrid channel missing required credentials (clientId, clientSecret)');
      throw new Error('Missing Astrid credentials');
    }

    this.adapter = SDKChannel.createAdapter({
      enabled: true,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      apiBase: this.config.apiBase || 'https://www.astrid.cc/api/v1',
    });

    api.onOutbound(async (message: LegacyOutboundMessage) => {
      await this.send(message);
    });

    api.log('info', 'Astrid channel plugin initialized');
  }

  async start(): Promise<void> {
    if (!this.adapter || !this.api) {
      throw new Error('Channel not initialized');
    }

    await this.adapter.init();

    await this.adapter.connect((message: any) => {
      this.handleInboundMessage(message).catch((error) => {
        this.api!.log('error', 'Failed to handle inbound message', { error: error.message });
      });
    });

    this.api.log('info', 'Astrid channel started and listening for tasks');
  }

  async stop(): Promise<void> {
    if (this.adapter) {
      await this.adapter.disconnect();
    }
    this.sessionMap.clear();
    this.api?.log('info', 'Astrid channel stopped');
  }

  async send(message: LegacyOutboundMessage): Promise<void> {
    if (!this.adapter) {
      throw new Error('Channel not started');
    }

    const taskId = message.sessionKey.replace(/^astrid:task:/, '');

    if (!taskId || taskId === message.sessionKey) {
      this.api?.log('warn', 'Invalid session key for Astrid channel', { sessionKey: message.sessionKey });
      return;
    }

    try {
      if (message.action === 'complete') {
        if (message.content) {
          await this.adapter.send({
            content: message.content,
            sessionKey: message.sessionKey,
          });
        }

        await this.adapter.send({
          content: message.content || 'Task completed',
          sessionKey: message.sessionKey,
        });

        this.sessionMap.delete(taskId);
      } else {
        await this.adapter.send({
          content: message.content,
          sessionKey: message.sessionKey,
        });
      }

      this.api?.log('debug', `Sent message to task ${taskId}`, {
        action: message.action || 'comment',
        length: message.content.length,
      });
    } catch (error) {
      this.api?.log('error', `Failed to send message to task ${taskId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  getStatus() {
    return {
      connected: this.adapter?.isConnected() || false,
      activeSessions: this.sessionMap.size,
      lastActivity: new Date().toISOString(),
    };
  }

  private async handleInboundMessage(sdkMessage: any): Promise<void> {
    if (!this.api) return;

    const taskId = sdkMessage.metadata?.taskId;
    if (!taskId) {
      this.api.log('warn', 'Received message without task ID', { sdkMessage });
      return;
    }

    const sessionKey = `astrid:task:${taskId}`;
    this.sessionMap.set(taskId, sessionKey);

    let content = sdkMessage.content || '';
    let messageType: 'task' | 'comment' = 'comment';

    if (sdkMessage.metadata?.type === 'task' || content.startsWith('# Task:')) {
      messageType = 'task';

      const taskData = sdkMessage.metadata;
      content = `# Task: ${taskData?.title || 'Untitled Task'}

${taskData?.description || ''}

**List:** ${taskData?.listName || 'Unknown'}
**Priority:** ${this.formatPriority(taskData?.priority)}
${taskData?.dueDateTime ? `**Due:** ${new Date(taskData.dueDateTime).toLocaleDateString()}` : ''}

${taskData?.listDescription ? `## Instructions\n${taskData.listDescription}` : ''}`;
    }

    const message: LegacyInboundMessage = {
      channel: 'astrid',
      sessionKey,
      content,
      from: sdkMessage.from || taskId,
      fromName: sdkMessage.fromName || 'Astrid Task',
      timestamp: new Date().toISOString(),
      metadata: {
        taskId,
        type: messageType,
        listName: sdkMessage.metadata?.listName,
        listDescription: sdkMessage.metadata?.listDescription,
        priority: sdkMessage.metadata?.priority,
        dueDateTime: sdkMessage.metadata?.dueDateTime,
      },
    };

    await this.api.injectMessage(message);
    this.api.log('debug', `Injected ${messageType} message for task ${taskId}`);
  }

  private formatPriority(priority?: number): string {
    switch (priority) {
      case 0: return 'None';
      case 1: return 'Low';
      case 2: return 'Medium';
      case 3: return 'High';
      default: return 'Unknown';
    }
  }
}
