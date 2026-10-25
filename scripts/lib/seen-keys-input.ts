import { readFileSync } from 'node:fs'
import { parseSeenKeys } from './wake-keys'

export function readSeenKeysInput(value?: string, file?: string): string[] {
  if (value !== undefined && file !== undefined) throw new Error('Pass --seen-keys or --seen-keys-file, not both')
  const text = file === undefined ? value : readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  const keys = parseSeenKeys(text)
  if (!keys || text === undefined || JSON.parse(text).length !== keys.length) {
    throw new Error('Seen keys must be a JSON array of strings')
  }
  return keys
}
