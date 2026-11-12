/**
 * AWTD-1605: astrid-core's shared art (design/assets: the checkbox and the
 * agent marks), vendored in packages/astrid-design/assets at the same
 * REVISION as the tokens. The manifest records each file's sha256; a copy that
 * does not hash to it was edited here, or copied from another revision.
 * astrid-core's `cargo xtask check-design ../astrid-web` compares the same
 * files against its own history.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const pkg = join(process.cwd(), 'packages', 'astrid-design')
const assets = join(pkg, 'assets')

interface Entry {
  name: string
  file: string
  sha256: string
  owner: string
}

const manifest = JSON.parse(readFileSync(join(assets, 'manifest.json'), 'utf8')) as { version: number; assets: Entry[] }

/** The manifest hashes the text with LF endings, so a CRLF checkout hashes the same. */
const hash = (path: string) =>
  createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [relative(assets, path).split('\\').join('/')]
  })
}

describe('the vendored shared art (AWTD-1605)', () => {
  it('every file hashes to the manifest', () => {
    expect(manifest.version).toBe(1)
    for (const entry of manifest.assets) {
      expect(hash(join(assets, entry.file)), `${entry.file}: re-run scripts/sync-design-tokens.sh; never edit it here`).toBe(
        entry.sha256,
      )
      expect(entry.owner.trim(), entry.name).not.toBe('')
    }
  })

  it('holds exactly the files the manifest lists', () => {
    const listed = manifest.assets.map((entry) => entry.file).sort()
    expect(filesUnder(assets).filter((file) => file !== 'manifest.json').sort()).toEqual(listed)
  })

  it('has the four checkbox variants, and the shapes file draws the same three layers', () => {
    const files = manifest.assets.map((entry) => entry.file)
    for (const variant of ['checkbox', 'checkbox-checked', 'checkbox-repeat', 'checkbox-repeat-checked']) {
      expect(files).toContain(`checkbox/${variant}.svg`)
    }
    const shapes = JSON.parse(readFileSync(join(pkg, 'checkbox-art.json'), 'utf8')) as {
      layers: Record<string, { d: string }[]>
    }
    const svg = readFileSync(join(assets, 'checkbox', 'checkbox-repeat-checked.svg'), 'utf8')
    for (const layer of ['repeat', 'check']) {
      for (const shape of shapes.layers[layer]) expect(svg, layer).toContain(`d="${shape.d}"`)
    }
    const box = readFileSync(join(assets, 'checkbox', 'checkbox.svg'), 'utf8')
    for (const shape of shapes.layers.box) expect(box).toContain(`d="${shape.d}"`)
  })

  // public/images/ai-agents is what the app serves today; it is the shared
  // mark, not a copy that can drift from the other clients'.
  it.each(manifest.assets.filter((entry) => entry.file.startsWith('agents/')).map((entry) => entry.file))(
    'the served agent mark %s is the shared one',
    (file) => {
      expect(hash(join(process.cwd(), 'public', 'images', 'ai-agents', file.replace('agents/', '')))).toBe(
        manifest.assets.find((entry) => entry.file === file)!.sha256,
      )
    },
  )
})
