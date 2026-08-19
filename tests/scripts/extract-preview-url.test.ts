/**
 * Extracting the Vercel preview URL from `vercel deploy` output.
 *
 * PR #206 burned a full CI cycle on this. The preview deployed fine, but the
 * "E2E Tests on Preview" job spent 60 attempts / 5 minutes curling a URL that
 * could never resolve, then failed the PR. What the workflow had captured was:
 *
 *   \x1b[2K\x1b[1A\x1b[2K\x1b[GPreviewhttps://astrid-xxx.vercel.app
 *
 * Three compounding mistakes in one line of shell:
 *   - `2>&1` folded the CLI's PROGRESS output (stderr, redrawn in place with
 *     cursor-control escapes) into the capture alongside the real stdout;
 *   - `grep -E 'https://...'` matched the whole progress LINE, label and
 *     escapes included, rather than the URL within it;
 *   - `tr -d ' '` then deleted the spaces separating `Preview` from the URL,
 *     welding them into one unusable token.
 *
 * The fixtures below are the real shapes vercel emits, escape codes and all.
 * The rule under test: whatever the surrounding noise, what comes out is a
 * bare, well-formed URL — or a non-zero exit, never a plausible-looking string
 * that fails five minutes later in another job.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { join } from 'path'

const SCRIPT = join(process.cwd(), 'scripts/extract-preview-url.sh')

/** The cursor-control escape vercel uses to redraw its progress line. */
const ESC = '\x1b'

function extract(stdin: string): { url: string; status: number } {
  try {
    const url = execFileSync('bash', [SCRIPT], { input: stdin, encoding: 'utf8' })
    return { url: url.trim(), status: 0 }
  } catch (error) {
    const err = error as { status: number; stdout?: string }
    return { url: (err.stdout || '').trim(), status: err.status }
  }
}

describe('extract-preview-url.sh', () => {
  it('recovers the URL from the exact output that broke PR #206', () => {
    // Verbatim shape from run 32217385573, with the escapes restored.
    const output = [
      'Vercel CLI 48.2.0',
      `${ESC}[2K${ESC}[1A${ESC}[2K${ESC}[GInspect: https://vercel.com/gracefultools/astrid/abc123 [2s]`,
      `${ESC}[2K${ESC}[1A${ESC}[2K${ESC}[G  Preview         https://astrid-ob6tmsy0n-gracefultools.vercel.app`,
      `${ESC}[2K${ESC}[1A${ESC}[2K${ESC}[Ghttps://astrid-ob6tmsy0n-gracefultools.vercel.appBuilding…`,
    ].join('\n')

    expect(extract(output).url).toBe('https://astrid-ob6tmsy0n-gracefultools.vercel.app')
  })

  it('never welds a label onto the URL, however the spacing collapses', () => {
    const { url } = extract('  Preview         https://astrid-xyz.vercel.app')
    expect(url).toBe('https://astrid-xyz.vercel.app')
    expect(url).not.toContain('Preview')
  })

  it('takes the deployment URL, not the inspect dashboard URL', () => {
    const output = [
      'Inspect: https://vercel.com/gracefultools/astrid/dep_123 [3s]',
      'https://astrid-real-deploy.vercel.app',
    ].join('\n')
    expect(extract(output).url).toBe('https://astrid-real-deploy.vercel.app')
  })

  it('emits a bare URL with no trailing whitespace or escapes', () => {
    const { url } = extract(`${ESC}[2K${ESC}[Ghttps://astrid-clean.vercel.app  \n`)
    expect(url).toMatch(/^https:\/\/[A-Za-z0-9._-]+\.vercel\.app$/)
  })

  it('fails loudly when there is no URL at all, rather than emitting nothing', () => {
    // The old code exited 1 here too — that part was right, and it stays right.
    const { status } = extract('Error: You do not have permission to deploy.')
    expect(status).not.toBe(0)
  })

  it('fails rather than emit a URL it cannot vouch for', () => {
    // A host that is not *.vercel.app is not the preview; better to stop than
    // to hand another job something that 404s five minutes later.
    const { status } = extract('https://example.com/not-a-preview')
    expect(status).not.toBe(0)
  })
})
