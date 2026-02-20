/**
 * Astrid.cc Channel Plugin for OpenClaw
 * 
 * Provides real-time task assignment and comment integration via SSE.
 */

import { AstridChannel as SDKChannel } from '@gracefultools/astrid-sdk';
import type { 
  ChannelPlugin, 
  OpenClawChannelAPI, 
  AstridChannelConfig, 
  InboundMessage, 
  OutboundMessage 
} from './types';

export class AstridChannelPlugin implements ChannelPlugin {
  private api: OpenClawChannelAPI | null = null;
  private config: AstridChannelConfig | null = null;
  private adapter: any = null; // SDK adapter instance
  private sessionMap = new Map<string, string>(); // taskId -> sessionKey

  async init(api: OpenClawChannelAPI): Promise<void> {
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

    // Create SDK adapter
    this.adapter = SDKChannel.createAdapter({
      enabled: true,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      apiBase: this.config.apiBase || 'https://www.astrid.cc/api/v1',
    });

    // Register outbound handler
    api.onOutbound(async (message: OutboundMessage) => {
      await this.send(message);
    });

    api.log('info', 'Astrid channel plugin initialized');
  }

  async start(): Promise<void> {
    if (!this.adapter || !this.api) {
      throw new Error('Channel not initialized');
    }

    // Initialize SDK adapter
    await this.adapter.init();

    // Connect with message handler
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

  async send(message: OutboundMessage): Promise<void> {
    if (!this.adapter) {
      throw new Error('Channel not started');
    }

    // Extract task ID from session key (format: astrid:task:12345)
    const taskId = message.sessionKey.replace(/^astrid:task:/, '');
    
    if (!taskId || taskId === message.sessionKey) {
      this.api?.log('warn', 'Invalid session key for Astrid channel', { sessionKey: message.sessionKey });
      return;
    }

    try {
      if (message.action === 'complete') {
        // Complete the task and optionally post a comment
        if (message.content) {
          // Post comment first, then complete
          await this.adapter.send({
            content: message.content,
            sessionKey: message.sessionKey,
          });
        }
        
        // Complete task (this would need to be added to the SDK)
        // For now, we'll post a completion comment
        await this.adapter.send({
          content: message.content || '✅ Task completed',
          sessionKey: message.sessionKey,
        });
        
        // Remove from session map
        this.sessionMap.delete(taskId);
        
      } else {
        // Regular comment
        await this.adapter.send({
          content: message.content,
          sessionKey: message.sessionKey,
        });
      }

      this.api?.log('debug', `Sent message to task ${taskId}`, { 
        action: message.action || 'comment',
        length: message.content.length 
      });

    } catch (error) {
      this.api?.log('error', `Failed to send message to task ${taskId}`, { 
        error: error instanceof Error ? error.message : String(error) 
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

  /**
   * Handle inbound messages from Astrid SDK
   */
  private async handleInboundMessage(sdkMessage: any): Promise<void> {
    if (!this.api) return;

    // Extract task ID from the SDK message metadata
    const taskId = sdkMessage.metadata?.taskId;
    if (!taskId) {
      this.api.log('warn', 'Received message without task ID', { sdkMessage });
      return;
    }

    // Generate session key
    const sessionKey = `astrid:task:${taskId}`;
    this.sessionMap.set(taskId, sessionKey);

    // Determine message type and content
    let content = sdkMessage.content || '';
    let messageType: 'task' | 'comment' = 'comment';

    // If this is a new task assignment, format it nicely
    if (sdkMessage.metadata?.type === 'task' || content.startsWith('# Task:')) {
      messageType = 'task';
      
      // Format task as a proper message
      const taskData = sdkMessage.metadata;
      content = `# Task: ${taskData?.title || 'Untitled Task'}

${taskData?.description || ''}

**List:** ${taskData?.listName || 'Unknown'}
**Priority:** ${this.formatPriority(taskData?.priority)}
${taskData?.dueDateTime ? `**Due:** ${new Date(taskData.dueDateTime).toLocaleDateString()}` : ''}

${taskData?.listDescription ? `## Instructions\n${taskData.listDescription}` : ''}`;
    }

    // Create OpenClaw inbound message
    const message: InboundMessage = {
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

    // Inject into OpenClaw session system
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