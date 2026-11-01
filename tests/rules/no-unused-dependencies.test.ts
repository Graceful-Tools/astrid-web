/**
 * AWTD-1457: these packages were declared in package.json but nothing in the repo
 * imported them — each one was audit surface (`npm run audit:prod`) and install time
 * for nothing. If one of them is needed again, add it back with the import that uses it
 * and delete it from this list.
 *
 * `@opentelemetry/api` stays: `@vercel/otel` (instrumentation.ts) requires it as a peer.
 * The Claude CLI is not needed here either: agent-run.yml installs a pinned copy
 * globally, and scripts/fixall-loop.sh runs ~/.local/bin/claude.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }

describe('AWTD-1457: dependencies nothing imports stay removed', () => {
  it.each([
    '@neondatabase/serverless',
    'openai',
    '@anthropic-ai/claude-agent-sdk',
    '@anthropic-ai/claude-code',
    'crypto-js',
    '@types/crypto-js',
    'body-parser',
    'eventsource',
    'lru-cache',
  ])('%s is not declared', (name) => {
    expect(declared).not.toHaveProperty([name])
  })

  it('keeps @opentelemetry/api, the peer @vercel/otel needs', () => {
    expect(declared).toHaveProperty(['@vercel/otel'])
    expect(declared).toHaveProperty(['@opentelemetry/api'])
  })
})
