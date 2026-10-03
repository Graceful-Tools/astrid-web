// Stands in for astrid-web's lib/virtual-list-utils.ts, which imports its types as values
// (`import { Task, TaskList } from "@/types/task"`) — fine for a bundler, a SyntaxError for
// Node's type stripping. `parseTaskInput` imports the module and never calls into it, so the
// stub throws on use: a driver that ever did reach it fails loudly rather than exporting a
// fixture built from nothing.

export function applyVirtualListFilter() {
  throw new Error('virtual-list-utils stub: a contract driver reached applyVirtualListFilter')
}
