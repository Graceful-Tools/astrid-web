#!/usr/bin/env tsx
/**
 * Validates and auto-fixes .claude/settings.local.json
 *
 * This script:
 * 1. Checks if settings.local.json exists
 * 2. Validates JSON syntax
 * 3. Removes comments if present (JSON doesn't support comments)
 * 4. Validates structure (permissions.allow, permissions.deny, permissions.ask)
 * 5. Creates backup before fixing
 *
 * Usage:
 *   npx tsx .claude/validate-settings.ts          # Check only
 *   npx tsx .claude/validate-settings.ts --fix    # Auto-fix issues
 */

import * as fs from 'fs'
import * as path from 'path'

const SETTINGS_PATH = path.join(process.cwd(), '.claude/settings.local.json')
const SETTINGS_EXAMPLE_PATH = path.join(process.cwd(), '.claude/settings.json.example')
const BACKUP_PATH = path.join(process.cwd(), '.claude/settings.local.json.backup')

interface PermissionsConfig {
  permissions: {
    allow?: string[]
    deny?: string[]
    ask?: string[]
  }
}

/**
 * Strip JSON-with-comments down to JSON.
 *
 * This MUST know whether it is inside a string. The permission patterns in
 * settings.json.example legitimately contain `//` — two `postgresql://` URLs, a
 * `curl http://localhost` line and `Read(//dev/**)` — and the regex this used to
 * use (`/\/\/.*$/gm`) cut every one of them off mid-string, leaving an
 * unterminated string and a settings file that no longer parsed. The command
 * that reported "auto-fixed" was the thing breaking it, and Claude Code then ran
 * with no permissions loaded at all.
 *
 * The detection path below already blanks string contents before looking for
 * comments, with a comment naming `//dev/**` as the hazard. This is the same
 * knowledge applied to removal, so the two halves finally agree.
 */
export function removeComments(jsonString: string): string {
  let out = ''
  let inString = false
  let index = 0

  while (index < jsonString.length) {
    const char = jsonString[index]
    const next = jsonString[index + 1]

    if (inString) {
      // A backslash escapes the next character, so a \" does not end the string.
      if (char === '\\') {
        out += char + (next ?? '')
        index += 2
        continue
      }
      if (char === '"') inString = false
      out += char
      index += 1
      continue
    }

    if (char === '"') {
      inString = true
      out += char
      index += 1
      continue
    }

    if (char === '/' && next === '/') {
      while (index < jsonString.length && jsonString[index] !== '\n') index += 1
      continue
    }

    if (char === '/' && next === '*') {
      index += 2
      while (index < jsonString.length && !(jsonString[index] === '*' && jsonString[index + 1] === '/')) {
        index += 1
      }
      index += 2
      continue
    }

    out += char
    index += 1
  }

  // Remove trailing commas before ] or }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

function validateStructure(config: any): string[] {
  const errors: string[] = []

  if (!config.permissions) {
    errors.push('Missing "permissions" key')
    return errors
  }

  const { permissions } = config

  if (!permissions.allow && !permissions.deny && !permissions.ask) {
    errors.push('Permissions must have at least one of: allow, deny, ask')
  }

  if (permissions.allow && !Array.isArray(permissions.allow)) {
    errors.push('"permissions.allow" must be an array')
  }

  if (permissions.deny && !Array.isArray(permissions.deny)) {
    errors.push('"permissions.deny" must be an array')
  }

  if (permissions.ask && !Array.isArray(permissions.ask)) {
    errors.push('"permissions.ask" must be an array')
  }

  return errors
}

async function validateSettings(shouldFix: boolean = false): Promise<void> {
  console.log('🔍 Validating .claude/settings.local.json...\n')

  // Check if file exists
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.error('❌ Error: .claude/settings.local.json not found')

    if (fs.existsSync(SETTINGS_EXAMPLE_PATH)) {
      console.log('💡 Found .claude/settings.json.example')
      if (shouldFix) {
        console.log('📋 Copying example to settings.local.json...')
        const example = fs.readFileSync(SETTINGS_EXAMPLE_PATH, 'utf-8')
        const cleaned = removeComments(example)
        fs.writeFileSync(SETTINGS_PATH, cleaned, 'utf-8')
        console.log('✅ Created settings.local.json from example')
      } else {
        console.log('Run with --fix to copy example file')
      }
    }

    process.exit(1)
  }

  // Read file
  const rawContent = fs.readFileSync(SETTINGS_PATH, 'utf-8')

  // Check for comments (but not // inside strings)
  // Remove all string content first to avoid false positives from paths like "//dev/**"
  const contentWithoutStrings = rawContent.replace(/"(?:[^"\\]|\\.)*"/g, '""')
  const hasComments = /\/\/|\/\*/.test(contentWithoutStrings)
  if (hasComments) {
    console.log('⚠️  Warning: File contains comments (JSON does not support comments)')

    if (shouldFix) {
      console.log('🔧 Removing comments...')
      const cleaned = removeComments(rawContent)

      // Create backup
      fs.writeFileSync(BACKUP_PATH, rawContent, 'utf-8')
      console.log(`💾 Backup saved to ${path.relative(process.cwd(), BACKUP_PATH)}`)

      // Write cleaned version
      fs.writeFileSync(SETTINGS_PATH, cleaned, 'utf-8')
      console.log('✅ Comments removed')

      // Re-read cleaned content
      const newContent = fs.readFileSync(SETTINGS_PATH, 'utf-8')
      validateJSON(newContent)
    } else {
      console.log('Run with --fix to remove comments automatically')
      process.exit(1)
    }
  } else {
    validateJSON(rawContent)
  }
}

function validateJSON(content: string): void {
  // Try to parse JSON
  let config: PermissionsConfig
  try {
    config = JSON.parse(content)
    console.log('✅ Valid JSON syntax')
  } catch (error) {
    console.error('❌ Invalid JSON syntax:')
    if (error instanceof Error) {
      console.error(`   ${error.message}`)
    }
    console.log('\n💡 Common issues:')
    console.log('   - Comments (// or /* */) are not allowed in JSON')
    console.log('   - Trailing commas before ] or }')
    console.log('   - Missing quotes around strings')
    console.log('   - Unescaped special characters')
    console.log('\nRun with --fix to attempt automatic fixes')
    process.exit(1)
  }

  // Validate structure
  const structureErrors = validateStructure(config)
  if (structureErrors.length > 0) {
    console.error('❌ Structure validation failed:')
    structureErrors.forEach(err => console.error(`   - ${err}`))
    process.exit(1)
  }

  console.log('✅ Valid structure')

  // Print summary
  const { allow = [], deny = [], ask = [] } = config.permissions
  console.log('\n📊 Permissions Summary:')
  console.log(`   Allow: ${allow.length} patterns`)
  console.log(`   Deny:  ${deny.length} patterns`)
  console.log(`   Ask:   ${ask.length} patterns`)

  console.log('\n✨ All validation checks passed!')
}

// Main execution — skipped when this module is imported (e.g. by its tests).
const invokedDirectly = process.argv[1]?.includes('validate-settings')

if (invokedDirectly) {
  const shouldFix = process.argv.includes('--fix')

  validateSettings(shouldFix).catch(error => {
    console.error('💥 Unexpected error:', error)
    process.exit(1)
  })
}
