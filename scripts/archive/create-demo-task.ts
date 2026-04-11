#!/usr/bin/env npx tsx
/**
 * Create a demo task assigned to Claude for terminal mode testing
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const ASTRID_API_BASE = 'https://astrid.cc';

async function main() {
  // Get token
  const tokenRes = await fetch(`${ASTRID_API_BASE}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.ASTRID_OAUTH_CLIENT_ID,
      client_secret: process.env.ASTRID_OAUTH_CLIENT_SECRET,
    }),
  });
  const { access_token } = await tokenRes.json() as { access_token: string };

  const listId = process.env.ASTRID_OAUTH_LIST_ID;

  // Create task with assignment
  console.log('Creating task...');
  const createRes = await fetch(`${ASTRID_API_BASE}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OAuth-Token': access_token,
    },
    body: JSON.stringify({
      title: 'Demo: AI plan posting in terminal mode',
      description: 'This is a simple demo task. The agent should post a plan comment and then mark complete.',
      listIds: [listId],
      priority: 1,
      assigneeId: 'ai-agent-claude',  // Assign directly
    }),
  });

  const data = await createRes.json() as { task?: { id: string; title: string } };
  if (!data.task) {
    console.error('Failed to create task:', data);
    return;
  }

  console.log('✅ Created task:', data.task.id);
  console.log('   Title:', data.task.title);
}

main().catch(console.error);
