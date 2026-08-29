#!/usr/bin/env tsx

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'

const root = process.cwd()
const docsRoot = join(root, 'docs')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

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

const problems: string[] = []

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
      problems.push(
        `${file.slice(root.length + 1)} -> ${destination}`,
      )
    }
  }
}

const canonicalVersionReferences = [
  ['next', 'Next.js'],
  ['react', 'React'],
  ['typescript', 'TypeScript'],
  ['prisma', 'Prisma'],
  ['@prisma/client', '@prisma/client'],
  ['dexie', 'Dexie'],
  ['vitest', 'Vitest'],
  ['@playwright/test', 'Playwright'],
  ['jsdom', 'jsdom'],
  ['@testing-library/react', 'React Testing Library'],
  ['tailwindcss', 'Tailwind CSS'],
  ['lucide-react', 'Lucide React'],
  ['react-hook-form', 'React Hook Form'],
  ['zod', 'Zod'],
  ['eslint', 'ESLint'],
  ['autoprefixer', 'autoprefixer'],
  ['openai', 'OpenAI'],
  ['resend', 'Resend'],
  ['web-push', 'web-push'],
] as const

const stackSource = readFileSync(join(docsRoot, 'context/stack.md'), 'utf8')
for (const [packageName, label] of canonicalVersionReferences) {
  const range = packageJson.dependencies[packageName] ?? packageJson.devDependencies[packageName]
  const version = range?.replace(/^[~^]/, '')
  if (!version || !stackSource.includes(`${label} ${version}`)) {
    problems.push(
      `docs/context/stack.md -> ${label} must match package.json (${version ?? 'missing package'})`,
    )
  }
}

if (problems.length > 0) {
  console.error(`Documentation validation failures (${problems.length}):`)
  for (const problem of problems) console.error(`- ${problem}`)
  process.exitCode = 1
} else {
  console.log(`Documentation links and stack versions valid across ${files.length} active Markdown files.`)
}
