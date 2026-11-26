import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('linked generated image safety', () => {
  const source = readFileSync(
    join(process.cwd(), 'app/api/secure-files/[fileId]/route.ts'),
    'utf8',
  )

  it('AWTD-image-lifecycle prevents replacing list-image blobs directly', () => {
    expect(source).toContain("existingFile.attachTarget === 'list-image'")
    expect(source).toContain('List images must be replaced through list settings.')
  })

  it('deletes only files that remain unattached', () => {
    expect(source).toContain('List images must be removed or replaced through list settings.')
    expect(source).toContain('where: { id: fileId, listId: null, commentId: null }')
    expect(source).toContain('deleted.count === 0')
  })
})
