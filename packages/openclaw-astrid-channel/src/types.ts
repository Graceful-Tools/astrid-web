/**
 * OpenClaw Channel Plugin Types for Astrid.cc
 */

// OpenClaw Plugin API Types
export interface OpenClawChannelAPI {
  /** Get configuration for this channel */
  getConfig<T = any>(key?: string): T;
  
  /** Inject a message into OpenClaw's session system */
  injectMessage(message: InboundMessage): Promise<void>;
  
  /** Register an outbound message handler */
  onOutbound(handler: (message: OutboundMessage) => Promise<void>): void;
  
  /** Log a message */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, any>): void;
  
  /** Register a setup command */
  registerCommand(name: string, handler: (args: string[]) => Promise<void>): void;
}

// Channel configuration
export interface AstridChannelConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  apiBase?: string;
  agentEmail?: string;
}

// Inbound message (task/comment → OpenClaw session)
export interface InboundMessage {
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

// Outbound message (OpenClaw → Astrid comment)
export interface OutboundMessage {
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

// Plugin lifecycle interface
export interface ChannelPlugin {
  /** Initialize the plugin */
  init(api: OpenClawChannelAPI): Promise<void>;
  
  /** Start the channel (connect, begin listening) */
  start(): Promise<void>;
  
  /** Stop the channel */
  stop(): Promise<void>;
  
  /** Send an outbound message */
  send(message: OutboundMessage): Promise<void>;
  
  /** Get channel status */
  getStatus(): {
    connected: boolean;
    activeSessions: number;
    lastActivity?: string;
  };
}