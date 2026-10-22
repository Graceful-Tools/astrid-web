#!/usr/bin/env npx tsx
/**
 * Create a task in Astrid via OAuth API
 * Usage: npx tsx scripts/create-task.ts "Task title" ["Optional description" | --description-file <path>] [-p priority]
 */

import { loadScriptEnv } from './lib/load-env'
import { parseCreateTaskArgs, type CreateTaskArgs } from './lib/create-task-args'

loadScriptEnv()

const ASTRID_API_BASE = 'https://astrid.cc';

async function getAccessToken(): Promise<string> {
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing ASTRID_OAUTH_CLIENT_ID or ASTRID_OAUTH_CLIENT_SECRET');
  }

  const response = await fetch(`${ASTRID_API_BASE}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

interface CreateTaskOptions {
  title: string;
  listId: string;
  description?: string;
  priority?: number;
  assigneeEmail?: string;
}

async function createTask({ title, listId, description, priority = 1, assigneeEmail }: CreateTaskOptions) {
  console.log('🔐 Obtaining OAuth access token...');
  const accessToken = await getAccessToken();
  console.log('✅ Access token obtained');

  // If assignee email provided, look up the user
  let assigneeId: string | undefined;
  if (assigneeEmail) {
    const usersRes = await fetch(`${ASTRID_API_BASE}/api/v1/tasks?listId=${listId}&limit=1`, {
      headers: { 'X-OAuth-Token': accessToken },
    });
    // We can't look up users directly, so we skip assignee for now
    // The task can be assigned later via the UI
    console.log(`ℹ️  Assignee "${assigneeEmail}" noted (assign via Astrid UI)`);
  }

  console.log(`📝 Creating task: "${title}" (priority: ${priority})`);
  const body: Record<string, unknown> = {
    title,
    description,
    listIds: [listId],
    priority,
  };
  if (assigneeId) {
    body.assigneeId = assigneeId;
  }

  const response = await fetch(`${ASTRID_API_BASE}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OAuth-Token': accessToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create task: ${response.status} - ${text}`);
  }

  const data = await response.json();
  console.log('✅ Task created successfully!');
  console.log(`📋 Task ID: ${data.task.id}`);
  console.log(`📋 Title: ${data.task.title}`);
  console.log(`📋 Priority: ${data.task.priority}`);
  return data.task;
}

// Main
const USAGE =
  'Usage: npx tsx scripts/create-task.ts "Task title" ["Description" | --description-file <path>] [-p priority]';

const listId = process.env.ASTRID_OAUTH_LIST_ID;
if (!listId) {
  console.error('❌ Missing ASTRID_OAUTH_LIST_ID environment variable');
  process.exit(1);
}

let parsed: CreateTaskArgs;
try {
  parsed = parseCreateTaskArgs(process.argv.slice(2));
} catch (error) {
  console.error(`❌ ${(error as Error).message}\n${USAGE}`);
  process.exit(1);
}
const { title, description, priority } = parsed;

if (!title) {
  console.error(USAGE);
  process.exit(1);
}

createTask({ title, listId, description: description || undefined, priority }).catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
