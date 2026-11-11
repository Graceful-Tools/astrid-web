import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TEXT_EXTENSIONS = new Set(['.md', '.ts', '.tsx', '.yml', '.yaml'])
const NPM_CLI_ALLOWLIST = new Set(['next', 'playwright', 'prisma', 'tsx', 'tsc', 'web-push'])
const SURFACES = [
  'ASTRID.md',
  'app',
  'components',
  'docs',
  'lib/agent-skill',
  '.github/workflows/publish-astrid-sdk.yml',
]

function textFiles(path: string): string[] {
  const entries = readdirSync(path, { withFileTypes: true })
  return entries.flatMap(entry => {
    const childPath = join(path, entry.name)
    if (entry.isDirectory()) return textFiles(childPath)
    return TEXT_EXTENSIONS.has(childPath.slice(childPath.lastIndexOf('.'))) ? [childPath] : []
  })
}

function npxPackagesIn(path: string): Array<{ file: string; line: number; packageName: string }> {
  const contents = readFileSync(path, 'utf8')
  const results: Array<{ file: string; line: number; packageName: string }> = []
  const commandPattern = /\bnpx\s+(?:(?:--yes|--no-install)\s+)*([^\s`"'\\]+)/g

  for (const match of contents.matchAll(commandPattern)) {
    const token = match[1]
    const versionSeparator = token.startsWith('@')
      ? token.indexOf('@', token.indexOf('/') + 1)
      : token.indexOf('@')
    const packageName = token.slice(0, versionSeparator < 0 ? token.length : versionSeparator)

    results.push({
      file: path,
      line: contents.slice(0, match.index).split('\n').length,
      packageName,
    })
  }

  return results
}

function workspaceExecutables(): Set<string> {
  const packages = readdirSync('packages', { withFileTypes: true })
  const executables = new Set<string>()

  for (const entry of packages) {
    if (!entry.isDirectory()) continue
    const manifestPath = join('packages', entry.name, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string
      bin?: string | Record<string, string>
    }
    if (typeof manifest.bin === 'string' && manifest.name) {
      executables.add(manifest.name.split('/').at(-1)!)
    } else {
      for (const executable of Object.keys(manifest.bin ?? {})) executables.add(executable)
    }
  }

  return executables
}

describe('npx commands in setup guidance (AWTD-1568)', () => {
  it('only names workspace executables or explicitly allowed npm CLIs', () => {
    const files = SURFACES.flatMap(path =>
      path === 'ASTRID.md' || path.endsWith('.yml') ? [path] : textFiles(path),
    )
    const workspaceBins = workspaceExecutables()
    const unsupported = files
      .flatMap(npxPackagesIn)
      .filter(({ packageName }) => !workspaceBins.has(packageName) && !NPM_CLI_ALLOWLIST.has(packageName))

    expect(unsupported).toEqual([])
  })
})
