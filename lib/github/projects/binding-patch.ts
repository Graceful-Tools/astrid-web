/**
 * Validating a mapping edit from a client (AWTD-1151, §11.2): the bind body's
 * `mapping`, and PATCH .../binding. Only the four fields a person may choose;
 * anything else in the body is refused rather than ignored.
 */

import type { BindingPatch } from '@/services/github-projects.service'

const KEYS = ['statusOptionMap', 'priorityFieldId', 'priorityOptionMap', 'dueFieldId'] as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const nullableString = (v: unknown) => v === null || typeof v === 'string'

export function parseBindingPatch(raw: unknown): { value: BindingPatch } | { error: string } {
  if (!isRecord(raw)) return { error: 'mapping must be an object' }
  const unknownKey = Object.keys(raw).find(k => !(KEYS as readonly string[]).includes(k))
  if (unknownKey) return { error: `Unknown mapping field: ${unknownKey}` }

  const value: BindingPatch = {}
  if ('statusOptionMap' in raw) {
    const map = raw.statusOptionMap
    if (!isRecord(map) || !Object.values(map).every(v => typeof v === 'string' && v.length > 0)) {
      return { error: 'statusOptionMap must map option ids to roles' }
    }
    value.statusOptionMap = map as Record<string, string>
  }
  if ('priorityFieldId' in raw) {
    if (!nullableString(raw.priorityFieldId)) return { error: 'priorityFieldId must be a string or null' }
    value.priorityFieldId = raw.priorityFieldId as string | null
  }
  if ('priorityOptionMap' in raw) {
    const map = raw.priorityOptionMap
    const valid =
      map === null ||
      (isRecord(map) && Object.values(map).every(v => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3))
    if (!valid) return { error: 'priorityOptionMap must map option ids to 0..3, or be null' }
    value.priorityOptionMap = map as Record<string, number> | null
  }
  if ('dueFieldId' in raw) {
    if (!nullableString(raw.dueFieldId)) return { error: 'dueFieldId must be a string or null' }
    value.dueFieldId = raw.dueFieldId as string | null
  }
  return { value }
}
