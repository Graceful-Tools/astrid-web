import { createRequire } from 'node:module'
import path from 'node:path'

// Search parsing is astrid-core's alone (ADEV-313): there is no TypeScript fallback, so the server
// refuses a search when no core is installed. Tests that search get the vendored core here, loaded
// on first use so files that never search pay nothing. A test that wants the refusal calls
// setSearchQueryCore(null) and puts the core back with installTestSearchCore().
const CORE_KEY = Symbol.for('astrid.searchQuery.core')
let runJson: ((request: string) => string) | undefined

function searchWithVendoredCore(query: string) {
  if (!runJson) {
    const dir = path.join(process.cwd(), 'packages', 'astrid-rules', 'node', 'package.json')
    runJson = (createRequire(dir)('./astrid_rules_wasm.js') as { runJson(request: string): string }).runJson
  }
  const reply = JSON.parse(runJson(JSON.stringify({ kind: 'searchParse', query }))) as {
    ok: boolean
    value?: Record<string, unknown>
  }
  if (!reply.ok || !reply.value) return undefined
  const { isEmpty: _isEmpty, ...parsed } = reply.value
  return parsed
}

export function installTestSearchCore(): void {
  ;(globalThis as Record<symbol, unknown>)[CORE_KEY] = searchWithVendoredCore
}

installTestSearchCore()
