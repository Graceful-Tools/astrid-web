// Runs astrid-web's leading-control rules (lib/task-leading-control.ts) over every combination of
// assignee, reader and completion, and prints the mark each draws and whether a tap opens the
// options sheet instead of completing, and whether completing asks first (ADEV-255). ADEV-147: a completed task shows the checked checkbox
// whoever holds it, while someone else's task still opens the sheet rather than reopening.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Usage: node scripts/contract-fixtures/drivers/leading-control.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/leading-control.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const {
  taskLeadingControlKind,
  isSomeoneElsesTask,
  leadingControlOpensOptions,
  completionNeedsConfirmation,
} = await import(
  pathToFileURL(join(webRoot, 'lib/task-leading-control.ts')).href
)

// '' is how the API says unassigned, the same as null.
const ASSIGNEES = [null, '', 'me', 'other']
const READERS = ['me', null]

const cases = []
for (const assigneeId of ASSIGNEES) {
  for (const currentUserId of READERS) {
    for (const completed of [false, true]) {
      const kind = taskLeadingControlKind({ assigneeId, currentUserId, completed })
      const isSomeoneElses = isSomeoneElsesTask({ assigneeId, currentUserId })
      cases.push({
        assigneeId,
        currentUserId,
        completed,
        kind,
        opensPicker: {
          listRow: leadingControlOpensOptions({ onBoard: false, isSomeoneElses, kind }),
          boardCard: leadingControlOpensOptions({ onBoard: true, isSomeoneElses, kind }),
        },
        // ADEV-255: completing from the options sheet asks first (core's
        // TaskRow.completionNeedsConfirmation reads this column).
        asksBeforeCompleting: completionNeedsConfirmation({ assigneeId, currentUserId, completed }),
      })
    }
  }
}

process.stdout.write(JSON.stringify({
  generatedFrom: 'lib/task-leading-control.ts',
  rule: 'completed → checkbox; else unassigned → unassigned; else someone else\'s (or no reader) → avatar; else checkbox. A tap opens the picker on a board card, on someone else\'s task, and on any mark that is not a checkbox; otherwise it completes (or reopens). asksBeforeCompleting: completed → false; no reader → true; otherwise assignee ≠ reader (ADEV-255).',
  cases,
}))
