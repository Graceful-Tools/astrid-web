/**
 * The /fixall seen-file is machine-local state, not repo state (task 055da8d0).
 *
 * It used to default to node_modules/.cache, so every `npm ci` wiped it and
 * every unanswered inbox/lane item woke a run at once on the next tick. The
 * default must live in the OS cache dir, which survives reinstalls, and the
 * one pre-move file must be adopted rather than abandoned.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import {
  defaultSeenFile,
  legacySeenFile,
  adoptLegacySeenFile,
} from '../../scripts/lib/fixall-seen-file'

describe('defaultSeenFile (task 055da8d0)', () => {
  it('lives outside the repo, in the OS cache dir — never under node_modules', () => {
    const file = defaultSeenFile('claude', 'list-123', 'darwin')
    expect(file).toBe(join(homedir(), 'Library', 'Caches', 'astrid-fixall', 'seen-claude-list-123.json'))
    expect(file).not.toContain('node_modules')
  })

  it('uses XDG_CACHE_HOME on linux when set, ~/.cache otherwise', () => {
    const saved = process.env.XDG_CACHE_HOME
    try {
      process.env.XDG_CACHE_HOME = '/tmp/xdg-test'
      expect(defaultSeenFile('claude', 'list-123', 'linux')).toBe(
        join('/tmp/xdg-test', 'astrid-fixall', 'seen-claude-list-123.json'),
      )
      delete process.env.XDG_CACHE_HOME
      expect(defaultSeenFile('claude', 'list-123', 'linux')).toBe(
        join(homedir(), '.cache', 'astrid-fixall', 'seen-claude-list-123.json'),
      )
    } finally {
      if (saved === undefined) delete process.env.XDG_CACHE_HOME
      else process.env.XDG_CACHE_HOME = saved
    }
  })

  it('names the file per agent and list', () => {
    expect(defaultSeenFile('codex', 'abc', 'darwin')).toContain('seen-codex-abc.json')
  })
})

describe('adoptLegacySeenFile (task 055da8d0)', () => {
  let sandbox: string
  let savedCwd: string

  beforeEach(() => {
    savedCwd = process.cwd()
    sandbox = join(tmpdir(), `fixall-seen-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(sandbox, { recursive: true })
    process.chdir(sandbox)
  })

  afterEach(() => {
    process.chdir(savedCwd)
    rmSync(sandbox, { recursive: true, force: true })
  })

  function writeLegacy(agent: string, listId: string, keys: string[]): string {
    const file = legacySeenFile(agent, listId)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(keys))
    return file
  }

  it('moves the legacy file to the new default once', () => {
    const legacy = writeLegacy('claude', 'list-123', ['comment:a:1'])
    const target = join(sandbox, 'new-home', 'seen-claude-list-123.json')

    expect(adoptLegacySeenFile('claude', 'list-123', target)).toBe(target)
    expect(existsSync(legacy)).toBe(false)
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(['comment:a:1'])
  })

  it('leaves an existing new-default file alone', () => {
    const legacy = writeLegacy('claude', 'list-123', ['comment:a:1'])
    const target = join(sandbox, 'new-home', 'seen-claude-list-123.json')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify(['comment:b:2']))

    expect(adoptLegacySeenFile('claude', 'list-123', target)).toBeNull()
    expect(existsSync(legacy)).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(['comment:b:2'])
  })

  it('does nothing when there is no legacy file', () => {
    const target = join(sandbox, 'new-home', 'seen-claude-list-123.json')
    expect(adoptLegacySeenFile('claude', 'list-123', target)).toBeNull()
    expect(existsSync(target)).toBe(false)
  })
})
