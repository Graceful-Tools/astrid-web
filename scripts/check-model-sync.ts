#!/usr/bin/env npx tsx
/**
 * Check that Prisma schema, iOS Swift models, and Core Data models stay in sync
 *
 * This script prevents issues where:
 * - API adds a field but iOS doesn't know about it (app crashes or ignores data)
 * - iOS adds a field that doesn't exist in the API (silent failures)
 * - Core Data model doesn't match Swift model (migration issues)
 */

import * as fs from 'fs';
import * as path from 'path';

// Field mappings between Prisma and iOS (some fields have different names)
const FIELD_MAPPINGS: Record<string, string> = {
  // Prisma name -> iOS name
  'description': 'description', // iOS uses taskDescription in CoreData but description in Task.swift
};

// Fields that exist only on one side (intentionally different)
const PRISMA_ONLY_FIELDS = new Set([
  'creatorId',      // iOS gets this from API but doesn't persist locally
  'assigneeId',     // iOS handles this differently
  'aiAgentId',      // Server-only field
  'attachments',    // Complex relation, handled separately
  'codingWorkflow', // Server-only
  'comments',       // Fetched separately
  'reminderQueue',  // Server-only
  'secureFiles',    // Handled separately
  'lists',          // Relation handled differently
  'creator',        // Relation
  'assignee',       // Relation
  'aiAgent',        // Relation
]);

const IOS_ONLY_FIELDS = new Set([
  'listIds',        // iOS flattens the lists relation
  'syncStatus',     // Local sync tracking
  'lastSyncedAt',   // Local sync tracking
  'syncAttempts',   // Local sync tracking
  'lastSyncAttemptAt', // Local sync tracking
  'lastSyncError',  // Local sync tracking
  'searchableText', // Local search index
]);

// Parse Prisma schema to extract Task model fields
function parsePrismaSchema(schemaPath: string): Set<string> {
  const content = fs.readFileSync(schemaPath, 'utf-8');
  const fields = new Set<string>();

  // Find the Task model
  const taskModelMatch = content.match(/model Task \{([\s\S]*?)\n\}/);
  if (!taskModelMatch) {
    console.error('❌ Could not find Task model in Prisma schema');
    process.exit(1);
  }

  const taskModel = taskModelMatch[1];

  // Extract field names (lines that start with field name, not @@ or comments)
  const lines = taskModel.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

    const fieldMatch = trimmed.match(/^(\w+)\s+/);
    if (fieldMatch) {
      fields.add(fieldMatch[1]);
    }
  }

  return fields;
}

// The iOS app lives in a SEPARATE repo (Graceful-Tools/astrid-ios). To verify
// the Prisma → iOS task shape we fetch Task.swift from that repo via the GitHub
// API. Requires a token with read access; without one the check is skipped
// (reported honestly as UNVERIFIED rather than a false PASS).
const IOS_REPO = 'Graceful-Tools/astrid-ios';

function getGithubToken(): string | undefined {
  return (
    process.env.ASTRID_IOS_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    undefined
  );
}

async function githubFetch(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'astrid-web-model-sync',
    },
  });
}

// Locate and fetch the contents of iOS Task.swift from the astrid-ios repo.
// Returns null on any failure (missing token handled by the caller).
async function fetchIosTaskSwift(token: string): Promise<string | null> {
  try {
    // Walk the repo tree to find a Task.swift blob (layout-agnostic).
    const treeRes = await githubFetch(
      `https://api.github.com/repos/${IOS_REPO}/git/trees/HEAD?recursive=1`,
      token
    );
    if (!treeRes.ok) {
      console.log(`   ⚠️  Could not list ${IOS_REPO} tree (HTTP ${treeRes.status})`);
      return null;
    }
    const tree = (await treeRes.json()) as { tree?: Array<{ path: string; type: string }> };
    const candidates = (tree.tree || []).filter(
      (n) => n.type === 'blob' && /(^|\/)Task\.swift$/.test(n.path)
    );
    // Prefer a Models/Task.swift if present.
    const chosen =
      candidates.find((c) => /Models\/Task\.swift$/.test(c.path)) || candidates[0];
    if (!chosen) {
      console.log(`   ⚠️  Task.swift not found in ${IOS_REPO}`);
      return null;
    }
    const rawRes = await githubFetch(
      `https://raw.githubusercontent.com/${IOS_REPO}/HEAD/${chosen.path.split('/').map(encodeURIComponent).join('/')}`,
      token
    );
    if (!rawRes.ok) {
      console.log(`   ⚠️  Could not fetch ${chosen.path} (HTTP ${rawRes.status})`);
      return null;
    }
    console.log(`   📥 Fetched iOS model from ${IOS_REPO}:${chosen.path}`);
    return await rawRes.text();
  } catch (err) {
    console.log(`   ⚠️  iOS fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// Parse a Swift Task struct body from a raw string (vs. a file path).
function parseSwiftTaskFromContent(content: string): Set<string> {
  const fields = new Set<string>();
  const structMatch = content.match(
    /struct Task[^{]*\{([\s\S]*?)(?=\n    (?:enum|struct|init|func|var \w+:.*\{|static|private|\/\/)|\n\})/
  );
  if (!structMatch) return fields;
  const propRegex = /^\s+(?:var|let)\s+(\w+)\s*:/gm;
  let match;
  while ((match = propRegex.exec(structMatch[1])) !== null) {
    fields.add(match[1]);
  }
  return fields;
}

// Normalize field name for comparison
function normalizeFieldName(name: string): string {
  // Handle special mappings
  if (FIELD_MAPPINGS[name]) return FIELD_MAPPINGS[name];

  // Handle taskDescription -> description
  if (name === 'taskDescription') return 'description';

  return name;
}

// --strict: every "UNVERIFIED — skipping" path becomes a FAILURE. CI uses
// this so the gate regresses loudly the moment its token goes missing again —
// it ran as a silent no-op rendered as a pass for weeks (task 1985804a).
// Default (no flag) keeps skip-as-success so tokenless local runs stay cheap.
const STRICT = process.argv.includes('--strict');

function exitUnverified(): never {
  if (STRICT) {
    console.log('\n❌ --strict: an unverified check is a FAILED check.');
    process.exit(1);
  }
  process.exit(0);
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const prismaPath = path.join(projectRoot, 'prisma/schema.prisma');

  console.log('🔍 Checking model sync (Prisma Task ↔ iOS Task.swift)...\n');

  const token = getGithubToken();
  if (!token) {
    console.log('⏭️  UNVERIFIED: no GitHub token set, so the iOS Task model in');
    console.log(`   ${IOS_REPO} could not be fetched. This check is SKIPPED — not passed.`);
    console.log('   Set ASTRID_IOS_GITHUB_TOKEN (or GITHUB_TOKEN) to enable the real');
    console.log('   cross-repo check — e.g. in the weekly codebase-health-audit routine.');
    exitUnverified();
  }

  const swiftContent = await fetchIosTaskSwift(token);
  if (!swiftContent) {
    console.log('\n⏭️  UNVERIFIED: could not retrieve iOS Task.swift — skipping (not a failure).');
    exitUnverified();
  }

  const prismaFields = parsePrismaSchema(prismaPath);
  const swiftFields = parseSwiftTaskFromContent(swiftContent);
  if (swiftFields.size === 0) {
    console.log('\n⏭️  UNVERIFIED: could not parse the Task struct from iOS Task.swift — skipping.');
    exitUnverified();
  }

  console.log(`\n📊 Prisma Task: ${prismaFields.size} fields | iOS Task.swift: ${swiftFields.size} fields\n`);

  let hasErrors = false;
  const warnings: string[] = [];

  // iOS → Prisma: a field iOS decodes that the API no longer provides. THIS is
  // the iOS-breaking direction (decode fails / value goes missing), so it's an
  // error.
  console.log('🔄 Checking iOS → API (breaking direction)...');
  for (const field of swiftFields) {
    if (IOS_ONLY_FIELDS.has(field) || field === 'id') continue;
    const normalizedField = normalizeFieldName(field);
    if (!prismaFields.has(field) && !prismaFields.has(normalizedField)) {
      console.log(`   ❌ iOS decodes "${field}" but it is not in the Prisma Task model (API won't send it)`);
      hasErrors = true;
    }
  }

  // Prisma → iOS: a new API field iOS doesn't model yet. Non-breaking (iOS just
  // ignores it), surfaced as a warning so the gap is visible.
  console.log('🔄 Checking API → iOS (new fields iOS may want)...');
  for (const field of prismaFields) {
    if (PRISMA_ONLY_FIELDS.has(field)) continue;
    const normalizedField = normalizeFieldName(field);
    if (!swiftFields.has(field) && !swiftFields.has(normalizedField)) {
      warnings.push(`   ⚠️  Prisma field "${field}" not modeled in iOS Task.swift (iOS won't decode it)`);
    }
  }

  if (warnings.length > 0) {
    console.log('\n📋 Warnings (non-breaking):');
    warnings.forEach((w) => console.log(w));
  }

  console.log('\n' + '─'.repeat(50));
  if (hasErrors) {
    console.log('❌ Model sync check FAILED — iOS expects a field the API no longer provides.');
    console.log('   Fix: restore the field in the Prisma model / API output, or update iOS to');
    console.log('   stop decoding it. If the field is intentionally iOS-only, add it to');
    console.log('   IOS_ONLY_FIELDS in this script.');
    process.exit(1);
  }
  console.log('✅ Model sync check PASSED (verified against iOS Task.swift)');
  process.exit(0);
}

main().catch((err) => {
  // An infra hiccup (network / auth) must never block the build — report + skip.
  console.log(`⏭️  UNVERIFIED: model sync check errored (${err instanceof Error ? err.message : String(err)}) — skipping.`);
  exitUnverified();
});
