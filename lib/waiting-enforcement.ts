/**
 * The server's switches for the Waiting rules (Jon, 2026-11-12), read from env.
 *
 * - `WAITING_ENFORCE_NATIVE` — `lenient` (default) | `enforce`. The Apple, Windows and Android
 *   apps already in people's hands have no Waiting picker, so a hard 422 would break their drag to
 *   Waiting. In `lenient`, a condition-less move into Waiting FROM A NATIVE APP is let through (the
 *   assignee is still cleared unless kept), logged and counted here. Web, the plain API, MCP and
 *   agent scripts are always enforced.
 * - `WAITING_SETTLE_MODE` — `off` | `dry-run` (default) | `apply`: the scheduled settle job.
 * - `WAITING_BACKFILL_MODE` — `off` | `dry-run` (default) | `apply`: its one-off backfill.
 *
 * Nothing here sets either mode to `apply`; that is a deliberate env change after the dry-run
 * report has been read.
 */
// Type only: lib/analytics-events.ts imports Prisma, and this module is read by /api/health and unit tests.
import type { AnalyticsPlatformValue } from '@/lib/analytics-events'

export type NativeEnforcement = 'lenient' | 'enforce'
export type JobMode = 'off' | 'dry-run' | 'apply'

export function nativeEnforcementFrom(setting: string | undefined = process.env.WAITING_ENFORCE_NATIVE): NativeEnforcement {
  return (setting ?? '').trim().toLowerCase() === 'enforce' ? 'enforce' : 'lenient'
}

/** `off` | `dry-run` | `apply`; anything else, or unset, is `dry-run` — the mode that writes nothing. */
export function jobModeFrom(setting: string | undefined): JobMode {
  const value = (setting ?? '').trim().toLowerCase()
  return value === 'off' || value === 'apply' ? value : 'dry-run'
}

export const settleModeFrom = (setting: string | undefined = process.env.WAITING_SETTLE_MODE) => jobModeFrom(setting)
export const backfillModeFrom = (setting: string | undefined = process.env.WAITING_BACKFILL_MODE) => jobModeFrom(setting)

/** `AnalyticsPlatform.IOS_APP`, `MAC_APP`, `WINDOWS_APP`, `ANDROID_APP` — spelled as their values. */
const NATIVE_PLATFORMS: ReadonlySet<AnalyticsPlatformValue> = new Set<AnalyticsPlatformValue>([
  'iOS-app',
  'mac-app',
  'windows-app',
  'android-app',
])

/** A native app, by lib/analytics-events.ts `detectPlatform`'s answer (the `x-platform` header). */
export function isNativePlatform(platform: AnalyticsPlatformValue | null | undefined): boolean {
  return Boolean(platform) && NATIVE_PLATFORMS.has(platform as AnalyticsPlatformValue)
}

/** Whether a refused move into Waiting from this platform is let through instead. */
export function letsNativeThrough(platform: AnalyticsPlatformValue | null | undefined, setting?: string): boolean {
  return isNativePlatform(platform) && nativeEnforcementFrom(setting) === 'lenient'
}

/**
 * The 422's message. Old native clients show the server's `error` verbatim, so it is a sentence a
 * person can act on, not a code.
 */
export const WAITING_NEEDS_CONDITION_USER_MESSAGE =
  'To move a task to Waiting, give it a future date or a task to wait on.'

// ── Counters, for /api/health ────────────────────────────────────────────────

const STATUS_KEY = Symbol.for('astrid.waiting.enforcement')
interface Counters {
  nativeLenient: Record<string, number>
  refused: number
}
type Host = { [STATUS_KEY]?: Counters }

function counters(): Counters {
  const host = globalThis as Host
  host[STATUS_KEY] ??= { nativeLenient: {}, refused: 0 }
  return host[STATUS_KEY]
}

export function countNativeLenient(platform: string): void {
  const c = counters()
  c.nativeLenient[platform] = (c.nativeLenient[platform] ?? 0) + 1
}

export function countRefused(): void {
  counters().refused++
}

export function waitingEnforcementStatus() {
  const c = counters()
  return { native: nativeEnforcementFrom(), nativeLenient: { ...c.nativeLenient }, refused: c.refused }
}
