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

/**
 * AWTD-1593: round 2. The 17 Radix primitives and the form/command/drawer/theme
 * libraries came in with the shadcn starter and were never used. dompurify 3 ships
 * its own types, and postcss.config.mjs loads only tailwindcss, so autoprefixer did
 * nothing. `@auth/core` is an *optional* peer of next-auth 4 (type-only, for the v5
 * adapter shape); the copy we declared was 0.41 against the 0.34 next-auth pins,
 * so `npm ls` reported it invalid.
 */
describe('AWTD-1593: round-2 unused dependencies stay removed', () => {
  it.each([
    '@radix-ui/react-accordion',
    '@radix-ui/react-alert-dialog',
    '@radix-ui/react-aspect-ratio',
    '@radix-ui/react-avatar',
    '@radix-ui/react-collapsible',
    '@radix-ui/react-context-menu',
    '@radix-ui/react-hover-card',
    '@radix-ui/react-menubar',
    '@radix-ui/react-navigation-menu',
    '@radix-ui/react-progress',
    '@radix-ui/react-radio-group',
    '@radix-ui/react-scroll-area',
    '@radix-ui/react-separator',
    '@radix-ui/react-slider',
    '@radix-ui/react-toggle',
    '@radix-ui/react-toggle-group',
    '@radix-ui/react-tooltip',
    'react-hook-form',
    '@hookform/resolvers',
    'cmdk',
    'input-otp',
    'vaul',
    'next-themes',
    '@types/dompurify',
    'autoprefixer',
    '@auth/core',
  ])('%s is not declared', (name) => {
    expect(declared).not.toHaveProperty([name])
  })

  it.each(['@testing-library/dom', 'js-yaml'])(
    '%s is test-only, so it is a devDependency',
    (name) => {
      expect(pkg.dependencies ?? {}).not.toHaveProperty([name])
      expect(pkg.devDependencies ?? {}).toHaveProperty([name])
    },
  )

  it('keeps @opentelemetry/api-logs, a peer of @vercel/otel', () => {
    expect(declared).toHaveProperty(['@opentelemetry/api-logs'])
  })
})
