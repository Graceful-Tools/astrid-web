/**
 * @gracefultools/openclaw-astrid-channel
 * 
 * OpenClaw channel plugin for Astrid.cc task management
 */

import { AstridChannelPlugin } from './channel';
import { setupAstridChannel } from './setup';
import type { OpenClawChannelAPI } from './types';

// Plugin instance
let plugin: AstridChannelPlugin | null = null;

/**
 * Plugin initialization (called by OpenClaw)
 */
export async function init(api: OpenClawChannelAPI): Promise<void> {
  plugin = new AstridChannelPlugin();
  await plugin.init(api);
  
  // Register setup command
  api.registerCommand('setup-astrid', async (args: string[]) => {
    await setupAstridChannel({ api, args });
  });
}

/**
 * Start the channel
 */
export async function start(): Promise<void> {
  if (!plugin) {
    throw new Error('Plugin not initialized');
  }
  await plugin.start();
}

/**
 * Stop the channel
 */
export async function stop(): Promise<void> {
  if (plugin) {
    await plugin.stop();
    plugin = null;
  }
}

/**
 * Send outbound message
 */
export async function send(message: any): Promise<void> {
  if (!plugin) {
    throw new Error('Plugin not initialized');
  }
  await plugin.send(message);
}

/**
 * Get channel status
 */
export function getStatus() {
  return plugin?.getStatus() || {
    connected: false,
    activeSessions: 0,
  };
}

// Export types for TypeScript users
export type { 
  AstridChannelConfig, 
  InboundMessage, 
  OutboundMessage 
} from './types';

// Plugin manifest (required by OpenClaw)
export const manifest = {
  id: 'astrid',
  name: 'Astrid.cc',
  version: '1.0.0',
  description: 'Task management channel for Astrid.cc',
  author: 'Graceful Tools',
  type: 'channel',
  
  // Configuration schema
  configSchema: {
    type: 'object',
    properties: {
      enabled: { 
        type: 'boolean', 
        default: false,
        description: 'Enable Astrid.cc channel'
      },
      clientId: { 
        type: 'string',
        description: 'OAuth client ID from Astrid.cc'
      },
      clientSecret: { 
        type: 'string',
        description: 'OAuth client secret from Astrid.cc'
      },
      apiBase: { 
        type: 'string',
        default: 'https://www.astrid.cc/api/v1',
        description: 'Astrid API base URL'
      },
      agentEmail: { 
        type: 'string',
        description: 'Agent email address (e.g., myagent.oc@astrid.cc)'
      },
    },
    required: ['clientId', 'clientSecret'],
  },

  // Setup command
  setupCommand: {
    name: 'setup-astrid',
    description: 'Interactive setup for Astrid.cc integration',
    usage: 'openclaw setup astrid',
  },
};