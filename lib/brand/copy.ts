/**
 * Brand-supplied copy sets.
 *
 * Task 97208a72. Some content is not a single value but a *voice*: Astrid's reminder
 * nags ("I die a little every time you ignore me") and its default list captions carry
 * a personality that a partner deployment will usually want to replace wholesale, not
 * translate word-for-word.
 *
 * Supplied as one JSON blob in `NEXT_PUBLIC_BRAND_COPY` rather than a variable per
 * string, because these are dozens of strings and they only make sense as a set.
 * `brands/<name>.brand.json` holds it as a readable `copy` object and
 * scripts/deploy-brand-preview.ts serialises it, so nobody hand-writes the JSON.
 *
 * Every field is optional and falls back to the built-in Astrid set, so a partial
 * override — say, just the nags — leaves everything else alone. Malformed JSON logs and
 * falls back rather than throwing: bad brand copy should degrade to the default voice,
 * never take down reminders.
 */

import { createLogger } from '@/lib/logger'

const log = createLogger('brand-copy')

export interface BrandReminderCopy {
  /** Opening nags, e.g. "Hi there! Have a sec?" */
  general?: string[]
  /** Shown when a task is due, e.g. "Time to work!" */
  due?: string[]
  /** Follow-ups after a snooze, e.g. "Ready to do this?" */
  responses?: string[]
}

export interface BrandListCaption {
  name?: string
  description?: string
}

export interface BrandCopy {
  reminders?: BrandReminderCopy
  /** Keyed by the virtual list type: today, notInList, assigned, … */
  defaultLists?: Record<string, BrandListCaption>
}

function parseBrandCopy(): BrandCopy {
  const raw = process.env.NEXT_PUBLIC_BRAND_COPY?.trim()
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      log.warn('NEXT_PUBLIC_BRAND_COPY is not an object — ignoring')
      return {}
    }
    return parsed as BrandCopy
  } catch (err) {
    // Degrade to the default voice rather than breaking reminders entirely.
    log.warn({ err }, 'NEXT_PUBLIC_BRAND_COPY is not valid JSON — falling back to defaults')
    return {}
  }
}

export const BRAND_COPY: BrandCopy = parseBrandCopy()

/**
 * Brand override for a reminder set, or null to use the built-in strings.
 * An empty array is treated as "not supplied" — a brand that wants no nags at all
 * should disable reminders, not ship an empty set that renders as a blank notification.
 */
export function brandReminders(kind: keyof BrandReminderCopy): string[] | null {
  const set = BRAND_COPY.reminders?.[kind]
  if (!Array.isArray(set) || set.length === 0) return null
  return set.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
}

/** Brand override for one default list's caption, if supplied. */
export function brandListCaption(virtualListType: string): BrandListCaption | null {
  return BRAND_COPY.defaultLists?.[virtualListType] ?? null
}
