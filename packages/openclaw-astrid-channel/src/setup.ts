/**
 * Setup command for Astrid.cc channel plugin
 * 
 * Provides interactive setup: `openclaw setup astrid`
 */

import { OpenClawChannelAPI } from './types';

interface SetupContext {
  api: OpenClawChannelAPI;
  args: string[];
}

export async function setupAstridChannel(ctx: SetupContext): Promise<void> {
  const { api, args } = ctx;

  api.log('info', '🐾 Setting up Astrid.cc integration...');

  // Check if already configured
  const currentConfig = api.getConfig('astrid');
  if (currentConfig?.enabled && currentConfig?.clientId) {
    api.log('info', '⚠️  Astrid channel appears to already be configured.');
    
    const overwrite = await promptYesNo('Do you want to reconfigure? (y/N): ');
    if (!overwrite) {
      api.log('info', 'Setup cancelled.');
      return;
    }
  }

  try {
    api.log('info', '');
    api.log('info', '📋 Astrid.cc Setup Steps:');
    api.log('info', '1. Register your OpenClaw agent');
    api.log('info', '2. Get OAuth credentials');
    api.log('info', '3. Configure OpenClaw');
    api.log('info', '');

    // Step 1: Get agent name
    const agentName = await promptInput(
      'Choose an agent name (lowercase, no spaces): ',
      validateAgentName
    );

    // Step 2: Register agent via API
    api.log('info', `📡 Registering agent "${agentName}.oc@astrid.cc"...`);
    
    const credentials = await registerAgent(agentName, api);
    
    if (!credentials) {
      api.log('error', '❌ Agent registration failed. Please try again or register manually at https://www.astrid.cc/settings/agents');
      return;
    }

    api.log('info', '✅ Agent registered successfully!');

    // Step 3: Configure OpenClaw
    const config = {
      enabled: true,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      apiBase: 'https://www.astrid.cc/api/v1',
      agentEmail: `${agentName}.oc@astrid.cc`,
    };

    // This would need to integrate with OpenClaw's config system
    // For now, we'll output the config for manual addition
    api.log('info', '');
    api.log('info', '⚙️  Add this to your OpenClaw config:');
    api.log('info', '');
    api.log('info', JSON.stringify({
      channels: {
        astrid: config
      }
    }, null, 2));
    api.log('info', '');

    // Step 4: Instructions
    api.log('info', '🎉 Setup complete! Next steps:');
    api.log('info', `1. Add the config above to your OpenClaw configuration`);
    api.log('info', '2. Restart OpenClaw: openclaw gateway restart');
    api.log('info', `3. Create tasks in Astrid and assign them to ${agentName}.oc@astrid.cc`);
    api.log('info', '4. Your agent will pick them up automatically!');
    api.log('info', '');
    api.log('info', '📖 Docs: https://www.astrid.cc/docs/openclaw');

  } catch (error) {
    api.log('error', '❌ Setup failed', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Register agent via Astrid API
 */
async function registerAgent(agentName: string, api: OpenClawChannelAPI): Promise<{ clientId: string; clientSecret: string } | null> {
  // This would need to integrate with user authentication
  // For now, we'll return instructions for manual registration
  
  api.log('info', '');
  api.log('info', '🔐 To complete setup, please:');
  api.log('info', '1. Go to https://www.astrid.cc/settings/agents');
  api.log('info', '2. Click "Connect Agent"');
  api.log('info', `3. Enter agent name: ${agentName}`);
  api.log('info', '4. Copy the Client ID and Client Secret');
  api.log('info', '');

  const clientId = await promptInput('Paste Client ID: ');
  const clientSecret = await promptInput('Paste Client Secret: ');

  if (!clientId || !clientSecret) {
    api.log('error', 'Missing credentials');
    return null;
  }

  return { clientId, clientSecret };
}

/**
 * Validate agent name
 */
function validateAgentName(name: string): string | null {
  if (!name || name.length < 2) {
    return 'Agent name must be at least 2 characters';
  }
  
  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(name)) {
    return 'Agent name must be lowercase alphanumeric with dots, hyphens, or underscores';
  }

  if (name.length > 32) {
    return 'Agent name must be 32 characters or less';
  }

  const reserved = ['admin', 'system', 'test', 'api', 'support', 'root', 'openclaw'];
  if (reserved.includes(name)) {
    return `"${name}" is reserved, please choose another name`;
  }

  return null;
}

/**
 * Prompt for user input (would need OpenClaw CLI integration)
 */
async function promptInput(message: string, validator?: (input: string) => string | null): Promise<string> {
  // This would integrate with OpenClaw's CLI prompt system
  // For now, return a placeholder
  throw new Error('Interactive prompts not yet implemented - please register manually at https://www.astrid.cc/settings/agents');
}

/**
 * Prompt for yes/no
 */
async function promptYesNo(message: string): Promise<boolean> {
  // This would integrate with OpenClaw's CLI prompt system
  throw new Error('Interactive prompts not yet implemented');
}