/**
 * ADEV-126: the documented image tag must exist on GHCR, not just agree across docs.
 * Offline: the network half is scripts/check-image-tag-published.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  documentedTag,
  failures,
  manifestUrl,
  tagsToCheck,
} from '../../scripts/lib/image-tag-published'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('ADEV-126 image-tag-published helpers', () => {
  it('reads the tag SELF_HOSTING.md documents', () => {
    expect(documentedTag(read('docs/deployment/SELF_HOSTING.md'))).toMatch(/^\d+\.\d+\.\d+$/)
    expect(documentedTag('nothing here')).toBeNull()
  })

  it('checks the app and the migrator', () => {
    expect(tagsToCheck('1.4.0')).toEqual(['1.4.0', '1.4.0-migrator'])
    expect(manifestUrl('1.4.0')).toBe(
      'https://ghcr.io/v2/graceful-tools/astrid-web/manifests/1.4.0'
    )
  })

  it('fails on anything other than 200', () => {
    expect(failures([{ tag: '1.4.0', status: 200 }, { tag: '1.4.0-migrator', status: 200 }])).toEqual([])
    const out = failures([{ tag: '1.4.0', status: 200 }, { tag: '1.4.0-migrator', status: 404 }])
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('1.4.0-migrator')
    expect(failures([{ tag: 'x', status: 0 }])[0]).toContain('no response')
  })
})

describe('ADEV-126 workflows', () => {
  it('the scheduled check never runs on pull requests or pushes, so a tag-bump docs PR can merge first', () => {
    const on = /^on:\n((?:[ \t].*\n|\n)*)/m.exec(read('.github/workflows/image-tag-published.yml'))?.[1] ?? ''
    expect(on).toMatch(/schedule/)
    expect(on).not.toMatch(/pull_request|push/)
  })

  it('release-image.yml runs the check as a final job on tags', () => {
    const wf = read('.github/workflows/release-image.yml')
    expect(wf).toMatch(/published:[\s\S]*needs: \[merge, smoke\][\s\S]*check-image-tag-published\.ts/)
    // The version comes from a job the final job actually needs; a rename of
    // `merge` left `needs.publish.outputs.version` empty once already.
    const job = wf.slice(wf.indexOf('\n  published:'))
    expect(job).toContain('${{ needs.merge.outputs.version }}')
  })
})
