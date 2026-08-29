#!/usr/bin/env npx tsx
/**
 * Detect breaking API changes by comparing current types against the API contract
 *
 * Breaking changes include:
 * - Removing a required field from the API contract
 * - Changing a field's type
 * - Removing enum values
 *
 * This script compares:
 * 1. types/task.ts interfaces against lib/api/api-contract.ts
 * 2. Prisma schema against the API contract
 *
 * If breaking changes are detected, the build fails with instructions
 * to either update the contract version or revert the changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  API_CONTRACTS,
  CURRENT_API_VERSION,
  type ContractFields,
} from '../lib/api/api-contract';

const projectRoot = path.resolve(__dirname, '..');

interface BreakingChange {
  entity: string;
  field: string;
  type: 'removed' | 'type_changed' | 'made_required' | 'enum_value_removed';
  details: string;
}

/**
 * Parse TypeScript interface from file
 */
function parseTypeScriptInterface(filePath: string, interfaceName: string): Map<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fields = new Map<string, string>();

  // Split by lines and find the interface start
  const lines = content.split('\n');
  let inInterface = false;
  let braceCount = 0;
  let interfaceBody = '';

  for (const line of lines) {
    if (!inInterface) {
      // Look for the exact interface declaration
      if (line.match(new RegExp(`^export interface ${interfaceName}\\s*[{<]`)) ||
          line.match(new RegExp(`^export interface ${interfaceName}$`))) {
        inInterface = true;
        braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        continue;
      }
    } else {
      // Count braces to find end of interface
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;

      if (braceCount <= 0) {
        break;
      }

      interfaceBody += line + '\n';
    }
  }

  if (!interfaceBody) {
    console.warn(`⚠️  Could not find interface ${interfaceName} in ${filePath}`);
    return fields;
  }

  // Parse field definitions
  const fieldRegex = /^\s+(\w+)(\?)?:\s*([^/\n]+)/gm;
  let fieldMatch;
  while ((fieldMatch = fieldRegex.exec(interfaceBody)) !== null) {
    const [, fieldName, optional, fieldType] = fieldMatch;
    const cleanType = fieldType.trim().replace(/[,;]$/, '');
    fields.set(fieldName, `${cleanType}${optional ? '?' : ''}`);
  }

  return fields;
}

/**
 * Parse every `enum X { ... }` block from the Prisma schema into a map of
 * enum name -> set of member values. Used to resolve contract enum fields whose
 * TypeScript type is a named alias (e.g. `repeatFrom: RepeatFromMode`) rather
 * than an inline literal union.
 */
function parsePrismaEnums(): Map<string, Set<string>> {
  const schemaPath = path.join(projectRoot, 'prisma/schema.prisma');
  const content = fs.readFileSync(schemaPath, 'utf-8');
  const enums = new Map<string, Set<string>>();

  const enumRegex = /enum\s+(\w+)\s*\{([\s\S]*?)\}/g;
  let match;
  while ((match = enumRegex.exec(content)) !== null) {
    const [, enumName, body] = match;
    const values = new Set<string>();
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
      const valMatch = trimmed.match(/^(\w+)/);
      if (valMatch) values.add(valMatch[1]);
    }
    enums.set(enumName, values);
  }

  return enums;
}

/**
 * Resolve the set of allowed values for an enum-typed field from its current
 * TypeScript type string. Handles inline literal unions ("a" | "b" | 0 | 1)
 * and named aliases that map to a Prisma enum. Returns null when the values
 * can't be determined (so the caller skips rather than false-flags).
 */
function extractEnumValues(
  typeStr: string,
  prismaEnums: Map<string, Set<string>>
): Set<string> | null {
  const t = typeStr.replace(/\?$/, '').trim();

  // Bare identifier → resolve via a Prisma enum of the same name.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
    const resolved = prismaEnums.get(t);
    return resolved ? new Set(resolved) : null;
  }

  // Inline literal union: split on | and collect string/number literals.
  const values = new Set<string>();
  for (const partRaw of t.split('|')) {
    const part = partRaw.trim();
    if (!part || part === 'null' || part === 'undefined') continue;
    const strLit = part.match(/^["'](.+)["']$/);
    if (strLit) { values.add(strLit[1]); continue; }
    if (/^-?\d+$/.test(part)) { values.add(part); continue; }
    // A non-literal member (e.g. another type) — can't verify reliably.
    return null;
  }
  return values.size > 0 ? values : null;
}

/**
 * Parse Prisma model from schema
 */
function parsePrismaModel(modelName: string): Map<string, string> {
  const schemaPath = path.join(projectRoot, 'prisma/schema.prisma');
  const content = fs.readFileSync(schemaPath, 'utf-8');
  const fields = new Map<string, string>();

  const modelRegex = new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`, 'm');
  const match = content.match(modelRegex);
  if (!match) {
    console.warn(`⚠️  Could not find model ${modelName} in Prisma schema`);
    return fields;
  }

  const modelBody = match[1];

  // Parse field definitions
  const lines = modelBody.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

    const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\?)?/);
    if (fieldMatch) {
      const [, fieldName, fieldType, optional] = fieldMatch;
      fields.set(fieldName, `${fieldType}${optional ? '?' : ''}`);
    }
  }

  return fields;
}

/**
 * Check for breaking changes against contract
 */
function checkBreakingChanges(
  entityName: string,
  contract: ContractFields,
  currentFields: Map<string, string>,
  prismaEnums: Map<string, Set<string>>
): BreakingChange[] {
  const changes: BreakingChange[] = [];

  // Contract scalar types we can compare against a TS type string. Object /
  // array / enum are handled separately (named TS types make substring checks
  // unreliable for object/array; enums get value-level checks below).
  const SCALAR_TYPES: Record<string, string[]> = {
    string: ['string'],
    number: ['number', 'int', 'float'],
    boolean: ['boolean'],
    date: ['date', 'datetime'],
  };

  for (const [fieldName, fieldDef] of Object.entries(contract)) {
    // Skip deprecated fields - they can be removed
    if (fieldDef.deprecated) continue;

    // Check if field exists in current implementation
    if (!currentFields.has(fieldName)) {
      // Field was removed - this is a breaking change if it was required
      if (fieldDef.required) {
        changes.push({
          entity: entityName,
          field: fieldName,
          type: 'removed',
          details: `Required field "${fieldName}" was removed from ${entityName}`,
        });
      }
      continue;
    }

    // Field exists — check for type changes / enum-value removals.
    const currentType = currentFields.get(fieldName)!;
    const expectedType = fieldDef.type;
    const isNullableOrUnion =
      currentType.includes('|') ||
      currentType.toLowerCase().includes('null') ||
      currentType.toLowerCase().includes('undefined');

    if (expectedType === 'enum') {
      // Enum-value removal: every value the contract promises must still be a
      // member of the current type's allowed values. Removing one breaks
      // clients (e.g. iOS) that decode it.
      if (!fieldDef.values || fieldDef.values.length === 0) continue;
      const currentValues = extractEnumValues(currentType, prismaEnums);
      if (!currentValues) continue; // can't determine — skip rather than false-flag
      for (const v of fieldDef.values) {
        if (v === null) continue; // null isn't an enum member
        if (!currentValues.has(String(v))) {
          changes.push({
            entity: entityName,
            field: fieldName,
            type: 'enum_value_removed',
            details: `Enum value "${String(v)}" was removed from ${entityName}.${fieldName} (current: ${currentType})`,
          });
        }
      }
      continue;
    }

    // Scalar type-change detection. Skip object/array (named TS types) and
    // skip nullable/union types (intentionally lenient — these are not breaking
    // on their own and substring-matching them is unreliable).
    const validTypes = SCALAR_TYPES[expectedType];
    if (!validTypes || isNullableOrUnion) continue;

    const ct = currentType.toLowerCase();
    const isCompatible = validTypes.some((t) => ct.includes(t));
    if (!isCompatible) {
      changes.push({
        entity: entityName,
        field: fieldName,
        type: 'type_changed',
        details: `Field "${fieldName}" type changed in ${entityName}: contract expects ${expectedType}, found "${currentType}"`,
      });
    }
  }

  return changes;
}

/**
 * Main function
 */
function main() {
  console.log('🔍 Checking for API breaking changes...\n');

  const typesPath = path.join(projectRoot, 'types/task.ts');
  const breakingChanges: BreakingChange[] = [];

  // Get current contract
  const contract = API_CONTRACTS[CURRENT_API_VERSION as keyof typeof API_CONTRACTS];

  // Prisma enums, used to resolve enum fields whose TS type is a named alias.
  const prismaEnums = parsePrismaEnums();

  // Check Task interface
  console.log('📋 Checking Task interface...');
  const taskFields = parseTypeScriptInterface(typesPath, 'Task');
  const taskChanges = checkBreakingChanges('Task', contract.Task, taskFields, prismaEnums);
  breakingChanges.push(...taskChanges);
  console.log(`   Found ${taskFields.size} fields in types/task.ts`);

  // Check TaskList interface
  console.log('📋 Checking TaskList interface...');
  const taskListFields = parseTypeScriptInterface(typesPath, 'TaskList');
  const taskListChanges = checkBreakingChanges('TaskList', contract.TaskList, taskListFields, prismaEnums);
  breakingChanges.push(...taskListChanges);
  console.log(`   Found ${taskListFields.size} fields in types/task.ts`);

  // Check User interface
  console.log('📋 Checking User interface...');
  const userFields = parseTypeScriptInterface(typesPath, 'User');
  const userChanges = checkBreakingChanges('User', contract.User, userFields, prismaEnums);
  breakingChanges.push(...userChanges);
  console.log(`   Found ${userFields.size} fields in types/task.ts`);

  // Check Comment interface
  console.log('📋 Checking Comment interface...');
  const commentFields = parseTypeScriptInterface(typesPath, 'Comment');
  const commentChanges = checkBreakingChanges('Comment', contract.Comment, commentFields, prismaEnums);
  breakingChanges.push(...commentChanges);
  console.log(`   Found ${commentFields.size} fields in types/task.ts`);

  // Also check Prisma schema matches
  console.log('\n📋 Checking Prisma Task model...');
  const prismaTaskFields = parsePrismaModel('Task');
  console.log(`   Found ${prismaTaskFields.size} fields in Prisma schema`);

  // Compare Prisma fields with contract
  for (const [fieldName, fieldDef] of Object.entries(contract.Task)) {
    if ('deprecated' in fieldDef && fieldDef.deprecated) continue;

    // Map TypeScript field names to Prisma field names
    const prismaFieldName = fieldName === 'creator' ? 'creatorId' : fieldName;

    // Skip relation fields and computed fields
    const skipFields = new Set([
      'creator',
      'assignee',
      'lists',
      'attachments',
      'comments',
      'secureFiles',
      'when',
      'dueDate',
    ]);

    if (skipFields.has(fieldName)) continue;

    if (fieldDef.required && !prismaTaskFields.has(prismaFieldName) && !prismaTaskFields.has(fieldName)) {
      // Check if it's a field that Prisma handles differently
      const prismaAliases: Record<string, string> = {
        repeatFrom: 'repeatFrom',
        occurrenceCount: 'occurrenceCount',
      };

      const actualPrismaName = prismaAliases[fieldName] || fieldName;
      if (!prismaTaskFields.has(actualPrismaName)) {
        console.log(`   ⚠️  Contract field "${fieldName}" not found in Prisma (may be computed)`);
      }
    }
  }

  // Report results
  console.log('\n' + '─'.repeat(60));

  if (breakingChanges.length > 0) {
    console.log('❌ BREAKING CHANGES DETECTED!\n');

    for (const change of breakingChanges) {
      console.log(`   ${change.entity}.${change.field}: ${change.details}`);
    }

    console.log('\n📝 To fix this:');
    console.log('');
    console.log('   Option 1: Revert the breaking change');
    console.log('   - Add the removed field back');
    console.log('   - Keep the field as optional if deprecating');
    console.log('');
    console.log('   Option 2: Create a new API version');
    console.log('   1. Update CURRENT_API_VERSION in lib/api/api-contract.ts');
    console.log('   2. Add V2_*_FIELDS contracts with the new schema');
    console.log('   3. Add transformation functions to convert V2 → V1');
    console.log('   4. Keep serving V1 for old clients via X-API-Version header');
    console.log('');
    console.log('   Option 3: Mark the field as deprecated (if removing intentionally)');
    console.log('   - Add "deprecated: true" to the field in api-contract.ts');
    console.log('   - The field can then be safely removed');

    process.exit(1);
  }

  // Check for new fields that should be added to contract
  console.log('\n📋 Checking for new fields not in contract...');

  const newFields: { entity: string; field: string }[] = [];

  // Compare current Task fields with contract
  for (const [field] of taskFields) {
    if (!contract.Task[field as keyof typeof contract.Task]) {
      // Skip common computed/local fields. subtaskDepth is a client-only
      // nesting annotation (types/task.ts) — it never travels on the wire, so
      // it does not belong in the API contract (task 1985804a).
      const skipFields = new Set(['when', 'dueDate', 'subtaskDepth']);
      if (!skipFields.has(field)) {
        newFields.push({ entity: 'Task', field });
      }
    }
  }

  // Compare current TaskList fields with contract
  for (const [field] of taskListFields) {
    if (!contract.TaskList[field as keyof typeof contract.TaskList]) {
      newFields.push({ entity: 'TaskList', field });
    }
  }

  if (newFields.length > 0) {
    console.log('   ⚠️  New fields found that should be added to API contract:');
    for (const { entity, field } of newFields) {
      console.log(`      - ${entity}.${field}`);
    }
    console.log('');
    console.log('   Add these to lib/api/api-contract.ts to track them.');
    console.log('   (This is a warning, not an error - new fields don\'t break clients)');
  } else {
    console.log('   ✅ All fields are tracked in the API contract');
  }

  console.log('\n' + '─'.repeat(60));
  console.log('✅ No breaking API changes detected');
  console.log(`   Current API version: v${CURRENT_API_VERSION}`);
  process.exit(0);
}

main();
