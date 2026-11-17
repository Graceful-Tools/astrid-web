/**
 * Where the /fixall loop's seen-file lives (task 055da8d0).
 *
 * WHY NOT node_modules/.cache. The seen-file is machine-local state — "which
 * inbox/lane items already woke a run" — not repo state. It used to default
 * to node_modules/.cache/astrid-fixall, so every `npm ci` wiped it and all
 * unanswered inbox/lane items woke a run at once on the next tick: a burst
 * of duplicate sessions for work the loop had already decided about. The OS
 * cache dir survives reinstalls: ~/Library/Caches on macOS (where the loop
 * runs under launchd), $XDG_CACHE_HOME or ~/.cache elsewhere.
 *
 * Pure on purpose: the path math and the one-time legacy adoption are unit
 * tested in tests/scripts/fixall-seen-file.test.ts, and the script stays a
 * thin caller.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

import { parseSeenKeys } from './wake-keys.js'

/** The seen-file for an agent+list when `--seen` is not given. */
export function defaultSeenFile(
  agent: string,
  listId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const cacheDir =
    platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches')
      : process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return join(cacheDir, 'astrid-fixall', `seen-${agent}-${listId}.json`)
}

/** The pre-2026-09-21 default, kept only so it can be adopted once. */
export function legacySeenFile(agent: string, listId: string): string {
  return join(
    process.cwd(),
    'node_modules',
    '.cache',
    'astrid-fixall',
    `seen-${agent}-${listId}.json`,
  )
}

/**
 * One-time move of the legacy seen-file to the new default. Returns the
 * adopted path, or null when there was nothing to adopt. Best effort: a
 * failed move just means the next tick starts with an empty memory — one
 * extra run, not a broken guard — so it never throws.
 */
export function adoptLegacySeenFile(
  agent: string,
  listId: string,
  seenFile: string,
): string | null {
  if (existsSync(seenFile)) return null
  const legacy = legacySeenFile(agent, listId)
  if (!existsSync(legacy)) return null
  try {
    mkdirSync(dirname(seenFile), { recursive: true })
    try {
      renameSync(legacy, seenFile)
    } catch (error) {
      // A checkout on another volume than the home directory cannot be
      // renamed across; copy and remove instead of giving up every tick.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      copyFileSync(legacy, seenFile)
      unlinkSync(legacy)
    }
    return seenFile
  } catch {
    return null
  }
}

/** The keys on disk; an unreadable file is an empty memory (one extra run beats a guard that cannot start). */
export function readSeen(file: string | undefined): Set<string> {
  if (!file || !existsSync(file)) return new Set()
  try {
    return new Set(parseSeenKeys(readFileSync(file, 'utf8')) ?? [])
  } catch {
    return new Set()
  }
}

/** Returns an error message when nothing was written, null on success. */
export function writeJson(file: string, value: unknown): string | null {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Strike counts for keys whose runs failed, beside the seen-file. */
export function attemptsFileFor(seenFile: string): string {
  return `${seenFile}.attempts.json`
}

export function readAttempts(file: string): Record<string, number> {
  if (!existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'),
    )
  } catch {
    return {}
  }
}

/** `--seen-keys <json>` or `--seen-keys-file <path>`, never both; a JSON array of strings or it throws. */
export function readSeenKeysInput(value?: string, file?: string): string[] {
  if (value !== undefined && file !== undefined) throw new Error('Pass --seen-keys or --seen-keys-file, not both')
  const text = file === undefined ? value : readFileSync(file, 'utf8').replace(/^﻿/, '')
  const keys = parseSeenKeys(text)
  if (!keys || text === undefined || JSON.parse(text).length !== keys.length) {
    throw new Error('Seen keys must be a JSON array of strings')
  }
  return keys
}
