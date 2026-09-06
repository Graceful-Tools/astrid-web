/**
 * `npm run validate:settings:fix` is the command CLAUDE.md and .claude/README.md
 * tell you to run before EVERY session. Its --fix path stripped `//` to end of
 * line as a comment without knowing whether it was inside a JSON string, so it
 * destroyed the four entries in settings.json.example that legitimately contain
 * `//`:
 *
 *   "Bash(DATABASE_URL=\"postgresql://...\" npx tsx scripts/...)"  -> cut at `postgresql:`
 *   "Read(//dev/**)"                                               -> cut at `Read(`
 *   "Bash(curl -X POST http://localhost:300*)"                     -> cut at `http:`
 *
 * leaving unterminated strings — so the file it had just "fixed" was
 * unparseable, and Claude Code ran the session with no permissions loaded.
 *
 * The detection path already got this right (it blanks string contents first,
 * with a comment naming `//dev/**` as the hazard). Only the removal path was
 * naive, so the script warned about nothing and then broke the file anyway.
 */
import { describe, it, expect } from 'vitest'
import { removeComments } from '@/.claude/validate-settings'

describe('removeComments (settings.local.json corruption)', () => {
  it('leaves a URL inside a string alone', () => {
    const source = '{"a": ["Bash(curl -X POST http://localhost:300*)"]}'
    expect(JSON.parse(removeComments(source))).toEqual({
      a: ['Bash(curl -X POST http://localhost:300*)'],
    })
  })

  it('leaves a postgres URL with credentials in it alone', () => {
    const entry = 'Bash(DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx x.ts)'
    const source = JSON.stringify({ allow: [entry] })
    expect(JSON.parse(removeComments(source)).allow).toEqual([entry])
  })

  it('leaves a protocol-relative-looking path alone', () => {
    const source = '{"a": ["Read(//dev/**)"]}'
    expect(JSON.parse(removeComments(source)).a).toEqual(['Read(//dev/**)'])
  })

  it('still removes a real line comment', () => {
    const source = '{\n  "a": 1 // the comment\n}'
    expect(JSON.parse(removeComments(source))).toEqual({ a: 1 })
  })

  it('still removes a real block comment', () => {
    expect(JSON.parse(removeComments('{/* gone */ "a": 1}'))).toEqual({ a: 1 })
  })

  it('does not treat a comment marker inside a string as a comment', () => {
    const source = '{"a": "not /* a */ comment", "b": 2}'
    expect(JSON.parse(removeComments(source))).toEqual({ a: 'not /* a */ comment', b: 2 })
  })

  it('handles an escaped quote before a URL without losing the rest of the line', () => {
    // The example file's DATABASE_URL entries are exactly this shape.
    const source = '{"a": ["x=\\"postgresql://h/db\\" y", "z"]}'
    expect(JSON.parse(removeComments(source)).a).toEqual(['x="postgresql://h/db" y', 'z'])
  })

  it('still removes trailing commas', () => {
    expect(JSON.parse(removeComments('{"a": [1, 2,],}'))).toEqual({ a: [1, 2] })
  })

  it('round-trips the real settings example without corrupting it', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const raw = fs.readFileSync('.claude/settings.json.example', 'utf8')
    const parsed = JSON.parse(removeComments(raw))
    const allow: string[] = parsed.permissions.allow
    expect(allow).toContain('Read(//dev/**)')
    expect(allow.some(p => p.includes('postgresql://postgres:password@localhost:5432/astrid_dev'))).toBe(true)
    expect(allow.every(p => !p.endsWith(':') && p !== 'Read(')).toBe(true)
  })
})
