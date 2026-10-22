/**
 * Argument parsing for scripts/create-task.ts.
 *
 * The description used to be "the second positional argument, whatever it
 * is", so `create-task.ts "Title" --description-file spec.md` filed a task
 * whose whole description was the literal `--description-file` and lost the
 * spec (AWTD-1312, filed from astrid-core, had to be reconstructed from the
 * filing session's comments). Now the flag works, and any other flag is
 * refused rather than stored.
 */

import { readFileSync } from 'node:fs'

export interface CreateTaskArgs {
  title: string
  description: string
  priority: number
}

export function parseCreateTaskArgs(
  argv: readonly string[],
  readFile: (path: string) => string = path => readFileSync(path, 'utf8')
): CreateTaskArgs {
  let priority = 1
  let descriptionFile: string | undefined
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--priority' || arg === '-p' || arg === '--description-file') {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      if (arg === '--description-file') descriptionFile = value
      else priority = parseInt(value, 10)
      i++
    } else if (arg.startsWith('-') && arg.length > 1) {
      throw new Error(`Unknown option ${arg}`)
    } else {
      positional.push(arg)
    }
  }

  if (descriptionFile !== undefined && positional.length > 1) {
    throw new Error('Pass the description positionally or with --description-file, not both')
  }

  return {
    title: positional[0] ?? '',
    description: descriptionFile !== undefined ? readFile(descriptionFile) : positional[1] ?? '',
    priority,
  }
}
