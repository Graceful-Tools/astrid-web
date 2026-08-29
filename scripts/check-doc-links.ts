#!/usr/bin/env tsx

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'

const root = process.cwd()
const docsRoot = join(root, 'docs')

function markdownFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) {
      return name === 'archive' ? [] : markdownFiles(path)
    }
    return extname(name) === '.md' ? [path] : []
  })
}

const files = [
  ...readdirSync(root)
    .filter(name => extname(name) === '.md')
    .map(name => join(root, name)),
  ...markdownFiles(docsRoot),
]

const broken: string[] = []

for (const file of files) {
  if (file.startsWith(join(docsRoot, 'templates'))) continue

  const source = readFileSync(file, 'utf8')
  const destinations = [
    ...source.matchAll(/!?\[[^\]]*]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g),
    ...source.matchAll(/^\s*\[[^\]]+]:\s*(<[^>]+>|\S+)/gm),
  ].map(match => match[1].replace(/^<|>$/g, ''))

  for (const destination of destinations) {
    if (
      destination.startsWith('#') ||
      destination.startsWith('/') ||
      /^[a-z][a-z\d+.-]*:/i.test(destination)
    ) {
      continue
    }

    const relativePath = decodeURIComponent(destination.split(/[?#]/, 1)[0])
    if (!relativePath) continue

    const target = resolve(dirname(file), relativePath)
    if (!existsSync(target)) {
      broken.push(
        `${file.slice(root.length + 1)} -> ${destination}`,
      )
    }
  }
}

if (broken.length > 0) {
  console.error(`Broken local documentation links (${broken.length}):`)
  for (const link of broken) console.error(`- ${link}`)
  process.exitCode = 1
} else {
  console.log(`Documentation links valid across ${files.length} active Markdown files.`)
}
