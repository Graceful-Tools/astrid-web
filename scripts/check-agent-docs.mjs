#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAX_CONTEXT_BYTES = 200_000
const MAX_FILE_BYTES = 50_000

const contextFiles = [
  'ASTRID.md',
  'AGENTS.md',
  'CLAUDE.md',
  'CODEX.md',
  'GEMINI.md',
  'docs/AGENT_ARCHITECTURE_SIMPLIFICATION.md',
  'docs/AGENT_FLEET.md',
  'docs/AGENT_INTEGRATION_SUPPORT_MATRIX.md',
  'docs/AGENT_POLLING_MODE.md',
  'docs/FIXALL_WEB.md',
  'docs/FIXALL_WORKFLOW.md',
  '.claude/commands/fixall.md',
  '.claude/commands/fixstuff.md',
  '.claude/commands/predeploy.md',
  '.claude/commands/weekly-deep-review.md',
  'lib/agent-skill/astrid-queue-skill.ts',
  'lib/agent-skill/loop-recipes.ts',
]

const linkFiles = [
  ...contextFiles.filter((file) => file.endsWith('.md')),
  'docs/README.md',
  'docs/setup/MCP_OAUTH_SETUP.md',
  'mcp/README.md',
]

const setupFiles = [
  'ASTRID.md',
  'docs/AGENT_ARCHITECTURE_SIMPLIFICATION.md',
  'docs/AGENT_FLEET.md',
  'docs/AGENT_INTEGRATION_SUPPORT_MATRIX.md',
  'docs/AGENT_POLLING_MODE.md',
  'docs/setup/MCP_OAUTH_SETUP.md',
  'mcp/README.md',
]

const generatedNodeEntrypoints = new Map([
  ['dist/mcp/mcp-server-oauth.js', 'build:mcp:oauth'],
])

let warningCount = 0

function warn(message) {
  warningCount += 1
  console.warn(`WARN ${message}`)
}

function absolute(file) {
  return path.join(ROOT, file)
}

function read(file) {
  const resolved = absolute(file)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    warn(`${file} is missing`)
    return null
  }
  return fs.readFileSync(resolved, 'utf8')
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length
}

function checkRelativeLinks(file, text) {
  const withoutCode = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
  const linkPattern = /!?\[(?:`[^`]*`|[^\]`])*\]\((<[^>]+>|[^)]+)\)/g

  for (const match of withoutCode.matchAll(linkPattern)) {
    const rawDestination = match[1].replace(/^<|>$/g, '').trim()
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(rawDestination)) continue

    const destination = rawDestination.split(/[?#]/, 1)[0]
    if (!destination) continue

    let decoded
    try {
      decoded = decodeURIComponent(destination)
    } catch {
      warn(`${file}:${lineAt(text, match.index)} has an invalid encoded link: ${rawDestination}`)
      continue
    }

    if (!fs.existsSync(path.resolve(path.dirname(absolute(file)), decoded))) {
      warn(`${file}:${lineAt(text, match.index)} links to missing path ${rawDestination}`)
    }
  }
}

function shellWords(text) {
  return text.replaceAll('`', '').match(/"[^"]*"|'[^']*'|[^\s"'`]+/g)?.map((word) =>
    word.replace(/^(["'`])|(["'`])$/g, ''),
  ) ?? []
}

function resolveNodePath(token) {
  let candidate = token
  if (candidate.includes('<') || candidate.includes('$')) return null

  const repoPrefix = candidate.lastIndexOf('astrid-web/')
  if (repoPrefix >= 0) candidate = candidate.slice(repoPrefix + 'astrid-web/'.length)
  else candidate = candidate.replace(/^\.\.\/+/, '')

  const generatedBy = generatedNodeEntrypoints.get(candidate)
  if (generatedBy) {
    const packageJson = JSON.parse(fs.readFileSync(absolute('package.json'), 'utf8'))
    return packageJson.scripts?.[generatedBy] && fs.existsSync(absolute('mcp/build-mcp-oauth.js'))
      ? 'generated'
      : null
  }

  return fs.existsSync(path.resolve(ROOT, candidate)) ? candidate : null
}

function checkSetupCommands(file, text) {
  const lines = text.split('\n')
  const packageJson = JSON.parse(fs.readFileSync(absolute('package.json'), 'utf8'))
  const localBins = absolute('node_modules/.bin')

  for (const [index, line] of lines.entries()) {
    if (!/\b(?:npx|node)\s+/.test(line)) continue
    const words = shellWords(line)
    const commandIndex = words.findIndex((word) => word === 'npx' || word === 'node')
    if (commandIndex < 0) continue

    const runtime = words[commandIndex]
    let target = words[commandIndex + 1]?.replace(/[),;]+$/, '')
    if (!target || target.startsWith('-')) continue

    if (runtime === 'npx') {
      if (target === 'tsx') {
        const script = words[commandIndex + 2]?.replace(/[),;]+$/, '')
        if (!script || !fs.existsSync(absolute(script))) {
          warn(`${file}:${index + 1} has an unresolved npx tsx command target: ${script ?? '(missing)'}`)
        }
        if (!fs.existsSync(path.join(localBins, 'tsx'))) {
          warn(`${file}:${index + 1} uses npx tsx but the local tsx binary is unavailable`)
        }
      } else {
        const packagePath = path.join(absolute('node_modules'), target, 'package.json')
        const packageInstalled = fs.existsSync(packagePath) || fs.existsSync(path.join(localBins, target))
        const declared = Boolean(packageJson.dependencies?.[target] || packageJson.devDependencies?.[target])
        if (!packageInstalled && !declared) {
          warn(`${file}:${index + 1} uses npx ${target}, which is not present in the local dependency set`)
        }
      }
    } else {
      if (target === '-e' || target === '-p') continue
      const resolved = resolveNodePath(target)
      if (!resolved) {
        warn(`${file}:${index + 1} has an unresolved node command target: ${target}`)
      }
    }
  }
}

let totalBytes = 0
console.log(`Agent-facing context budget: ${MAX_CONTEXT_BYTES} bytes total; ${MAX_FILE_BYTES} bytes per file`)
for (const file of contextFiles) {
  const filePath = absolute(file)
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    warn(`${file} is missing from the context budget`)
    continue
  }
  const bytes = fs.statSync(filePath).size
  totalBytes += bytes
  console.log(`  ${String(bytes).padStart(7)} bytes  ${file}`)
  if (bytes > MAX_FILE_BYTES) warn(`${file} exceeds the per-file context budget (${bytes}/${MAX_FILE_BYTES} bytes)`)
}
console.log(`  ${String(totalBytes).padStart(7)} bytes  TOTAL`)
if (totalBytes > MAX_CONTEXT_BYTES) {
  warn(`agent-facing context exceeds the total budget (${totalBytes}/${MAX_CONTEXT_BYTES} bytes)`)
}

for (const file of linkFiles) {
  const text = read(file)
  if (text !== null) checkRelativeLinks(file, text)
}

for (const file of setupFiles) {
  const text = read(file)
  if (text !== null) checkSetupCommands(file, text)
}

console.log(`Agent-doc checks completed with ${warningCount} warning(s); this check is warn-only.`)
