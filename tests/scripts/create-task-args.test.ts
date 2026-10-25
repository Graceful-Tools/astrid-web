/**
 * AWTD-1312 was filed with the description `--description-file`: the script
 * took its second positional argument as the description, flag or not, and the
 * spec was lost. A flag is now either understood or refused.
 */
import { describe, it, expect } from 'vitest'
import { parseCreateTaskArgs } from '../../scripts/lib/create-task-args'

const files: Record<string, string> = { 'spec.md': '## The contract\n\nDetails.' }
const readFile = (path: string) => {
  if (!(path in files)) throw new Error(`ENOENT: ${path}`)
  return files[path]
}

describe('parseCreateTaskArgs (AWTD-1312)', () => {
  it('AWTD-1312: reads the description from --description-file instead of storing the flag', () => {
    const args = parseCreateTaskArgs(['[web] A route', '--description-file', 'spec.md', '-p', '3'], readFile)
    expect(args).toEqual({ title: '[web] A route', description: '## The contract\n\nDetails.', priority: 3 })
  })

  it('AWTD-1312: refuses an unknown flag rather than filing it as the description', () => {
    expect(() => parseCreateTaskArgs(['Title', '--body-file', 'spec.md'], readFile)).toThrow(/Unknown option --body-file/)
  })

  it('refuses a flag with no value, and both description forms at once', () => {
    expect(() => parseCreateTaskArgs(['Title', '--description-file'], readFile)).toThrow(/needs a value/)
    expect(() => parseCreateTaskArgs(['Title', 'inline', '--description-file', 'spec.md'], readFile)).toThrow(/not both/)
  })

  it('keeps the positional form working', () => {
    expect(parseCreateTaskArgs(['-p', '2', 'Title', 'Inline description'], readFile)).toEqual({
      title: 'Title', description: 'Inline description', priority: 2,
    })
    expect(parseCreateTaskArgs(['Title'], readFile)).toEqual({ title: 'Title', description: '', priority: 1 })
  })
})
