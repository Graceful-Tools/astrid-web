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
import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

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
