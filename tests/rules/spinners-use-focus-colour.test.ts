import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// AWTD-1575: a spinner is a thin line with nothing behind it. The accent is a
// fill colour and is 2.84:1 as a line on Dark's cards; `border-theme-focus` is
// the token for an accent-coloured line and stays readable in every theme.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : []
  })
}

describe('spinners are drawn in the focus line colour, not the accent fill (AWTD-1575)', () => {
  it('no animate-spin element uses border-brand', () => {
    const offenders = ['app', 'components'].flatMap(files).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, where: `${file}:${index + 1}` }))
        .filter(({ line }) => line.includes('animate-spin') && /\bborder-brand\b/.test(line))
        .map(({ where }) => where),
    )
    expect(offenders).toEqual([])
  })
})
