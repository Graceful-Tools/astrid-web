#!/usr/bin/env npx tsx
/**
 * Assign a task to an AI agent
 * Usage: npx tsx scripts/assign-to-agent.ts <taskId> [agentEmail]
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const ASTRID_API_BASE = 'https://astrid.cc';

async function getAccessToken(): Promise<string> {
  const response = await fetch(`${ASTRID_API_BASE}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.ASTRID_OAUTH_CLIENT_ID,
      client_secret: process.env.ASTRID_OAUTH_CLIENT_SECRET,
    }),
  });
  const data = await response.json() as { access_token: string };
  return data.access_token;
}

async function getAgentId(token: string, email: string): Promise<string | null> {
  const listId = process.env.ASTRID_OAUTH_LIST_ID;
  const response = await fetch(`${ASTRID_API_BASE}/api/v1/lists/${listId}`, {
    headers: { 'X-OAuth-Token': token },
  });
  const data = await response.json() as {
    list?: {
      listMembers?: Array<{
        user: { id: string; email: string }
      }>
    }
  };
  const members = data.list?.listMembers || [];
  const agent = members.find(m => m.user?.email === email);
  return agent?.user?.id || null;
}

async function assignTask(taskId: string, assigneeId: string, token: string) {
  const response = await fetch(`${ASTRID_API_BASE}/api/v1/tasks/${taskId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-OAuth-Token': token
    },
    body: JSON.stringify({ assigneeId }),
  });

  if (!response.ok) {
    throw new Error(`Failed: ${response.status} ${await response.text()}`);
  }

  return await response.json();
}

async function main() {
  const taskId = process.argv[2];
  const email = process.argv[3] || 'claude@astrid.cc';

  if (!taskId) {
    console.error('Usage: npx tsx scripts/assign-to-agent.ts <taskId> [agentEmail]');
    process.exit(1);
  }

  console.log('🔐 Getting access token...');
  const token = await getAccessToken();

  console.log(`🔍 Looking up agent ID for ${email}...`);
  const agentId = await getAgentId(token, email);

  if (!agentId) {
    console.error(`❌ Could not find agent with email ${email}`);
    process.exit(1);
  }

  console.log(`✅ Found agent ID: ${agentId}`);

  console.log(`📋 Assigning task ${taskId} to ${email}...`);
  await assignTask(taskId, agentId, token);

  console.log(`✅ Task assigned to ${email}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
