/**
 * Which hi-fi empathy frame an empty board column shows on web (ADEV-144).
 *
 * Same deployment, so web reads the frame list directly instead of fetching the manifest that
 * native clients use (GET /api/v1/empathy-art). The rule is the shared one in ./rules.ts, so a
 * list shows the same metaphor on web, iOS and Mac on the same day.
 *
 * Returns null when there is no frame to show: a custom column, a deployment that is not
 * presenting Astrid's own mascot (a partner's board must not show it; iOS gates the same way),
 * or no list. Callers keep the built-in character in that case.
 */
import { ASTRID_ICON, BRAND } from '@/lib/brand/config'
import framesFile from './frames.json'
import { empathyMetaphorFor, empathyStateForColumn } from './rules'

const FRAME_FILES = new Map(framesFile.frames.map(frame => [`${frame.metaphor}/${frame.state}`, frame.file]))

export interface EmpathyBoardColumn {
  id: string
  kind: 'inbox' | 'status' | 'done'
}

export function empathyFrameSrc(
  listId: string | null | undefined,
  column: EmpathyBoardColumn,
  at: Date,
  brandIcon: string = BRAND.icon,
): string | null {
  if (!listId || brandIcon !== ASTRID_ICON) return null
  // A status column's id is its role (ready/doing/waiting); a custom one's is not, so it maps to none.
  const state = empathyStateForColumn({
    completed: column.kind === 'done',
    statusRole: column.kind === 'inbox' || column.kind === 'done' ? null : column.id,
  })
  if (!state) return null
  const file = FRAME_FILES.get(`${empathyMetaphorFor(listId, at)}/${state}`)
  return file ? `/images/empathy-art/${file}` : null
}
