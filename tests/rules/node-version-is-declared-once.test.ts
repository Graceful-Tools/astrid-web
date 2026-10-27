/**
 * One Node version, declared once (AWTD-1382).
 *
 * Until this, nothing declared the runtime: nine CI pins said 20, six said 22,
 * the Mac ran 25, and package.json had no `engines`. jsdom 30 (#298) passed all
 * 10798 tests locally and failed CI outright, because which undici it resolved
 * depended on the Node version — so a green local predeploy was not evidence
 * that CI would pass.
 *
 * `.nvmrc` is the single source. Every `actions/setup-node` step reads it via
 * `node-version-file`, and `engines.node` names the same major — which is also
 * what Vercel reads to pick the production runtime. A literal `node-version:`
 * anywhere in CI is how the drift starts again, so it fails here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const root = process.cwd()

function yamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return yamlFiles(path)
    return /\.ya?ml$/.test(entry.name) ? [path] : []
  })
}

const ciFiles = yamlFiles(join(root, '.github'))
const ciLines = ciFiles.flatMap(path =>
  readFileSync(path, 'utf8')
    .split('\n')
    .map((text, i) => ({ file: path.slice(root.length + 1), line: i + 1, text })),
)

const nvmrcPath = join(root, '.nvmrc')
const nvmrc = existsSync(nvmrcPath) ? readFileSync(nvmrcPath, 'utf8').trim() : ''
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

describe('Node version is declared once (AWTD-1382)', () => {
  it('finds the setup-node steps at all, so a rename cannot make this vacuous', () => {
    const setupNode = ciLines.filter(l => l.text.includes('actions/setup-node@'))
    expect(setupNode.length).toBeGreaterThan(15)
  })

  it('declares a bare major in .nvmrc', () => {
    expect(nvmrc).toMatch(/^\d+$/)
  })

  it('names the same major in package.json engines.node', () => {
    expect(pkg.engines?.node).toBe(`${nvmrc}.x`)
  })

  it('has no workflow or action name its own Node version', () => {
    const offenders = ciLines
      .filter(l => /^\s*node-version:/.test(l.text) || /^\s*NODE_VERSION:/.test(l.text))
      .map(l => `${l.file}:${l.line}: ${l.text.trim()}`)
    expect(offenders).toEqual([])
  })

  it('builds the self-hosted image on the same major (AWTD-1286)', () => {
    // A Dockerfile ARG cannot read .nvmrc, so it names the version; this keeps it honest.
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    expect(dockerfile.match(/^ARG NODE_VERSION=(\S+)$/m)?.[1]).toBe(nvmrc)
  })

  it('points every setup-node step at .nvmrc', () => {
    for (const path of ciFiles) {
      const text = readFileSync(path, 'utf8')
      const steps = text.split('actions/setup-node@').length - 1
      const reads = (text.match(/node-version-file:\s*['"]?\.nvmrc['"]?/g) ?? []).length
      expect({ file: path.slice(root.length + 1), reads }).toEqual({
        file: path.slice(root.length + 1),
        reads: steps,
      })
    }
  })
})
