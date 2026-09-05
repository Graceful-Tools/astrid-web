/**
 * Regression for task 7deef9e3: five repo scripts read an .env.local-only
 * credential but never called `loadScriptEnv()`, so they could not read
 * `.env.local` and died with "ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET
 * missing from .env.local" when run the way the docs say to run them.
 *
 * `scripts/set-task-status.ts` and `scripts/assign-task.ts` are the two steps
 * docs/FIXALL_WORKFLOW.md prescribes for saying on the board what the loop is
 * doing, so the whole board etiquette was dead from a plain shell.
 *
 * This guards the CLASS, not the five files: any script that reads one of these
 * credentials must load `.env.local` first.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const SCRIPTS_DIR = path.resolve(__dirname, '../../scripts')

/** Credentials that live only in .env.local — reading one implies needing the loader. */
const ENV_LOCAL_ONLY = ['ASTRID_OAUTH_CLIENT_ID', 'ASTRID_OAUTH_CLIENT_SECRET']

function scriptFiles(): string[] {
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter(name => name.endsWith('.ts'))
    .map(name => path.join(SCRIPTS_DIR, name))
}

describe('repo scripts that need .env.local load it', () => {
  it('every script reading an OAuth credential imports loadScriptEnv', () => {
    const offenders = scriptFiles()
      .filter(file => {
        const source = fs.readFileSync(file, 'utf8')
        const readsCredential = ENV_LOCAL_ONLY.some(name =>
          source.includes(`process.env.${name}`),
        )
        return readsCredential && !source.includes('loadScriptEnv')
      })
      .map(file => path.basename(file))
      .sort()

    expect(offenders).toEqual([])
  })
})
