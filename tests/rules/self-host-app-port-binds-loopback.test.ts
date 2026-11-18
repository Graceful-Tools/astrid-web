/**
 * ADEV-105: the self-hosted app's port is published on loopback unless the operator
 * says otherwise.
 *
 * Under `--profile tls` Caddy is the one proxy in front of the app and
 * TRUSTED_PROXY_DEPTH=1 trusts the last X-Forwarded-For hop. The app was still
 * published on 0.0.0.0:3000, so anyone who reached port 3000 directly skipped Caddy,
 * sent their own X-Forwarded-For, and picked their own rate-limit key. Compose cannot
 * vary `ports` by profile, so the bind address is a variable defaulting to 127.0.0.1;
 * exposing it (no TLS proxy, or a proxy on another host) is an explicit APP_BIND=0.0.0.0.
 *
 * The CI smoke test reaches the app as http://localhost:3000 from the runner, which
 * loopback still serves.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parse } from 'yaml'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

type ComposeService = { ports?: string[]; profiles?: string[] }
const compose = parse(read('deploy/self-host/docker-compose.yml')) as { services: Record<string, ComposeService> }

/** Compose interpolation with nothing set: every `${VAR:-default}` is its default. */
function withDefaults(value: string): string {
  return value.replace(/\$\{[A-Z_][A-Z0-9_]*(?::?-([^}]*))?\}/g, (_, fallback: string | undefined) => fallback ?? '')
}

/** `[ip:]host:container` → the host IP it binds, or undefined for all interfaces. */
function bindAddress(mapping: string): string | undefined {
  const parts = withDefaults(mapping).split(':')
  return parts.length === 3 ? parts[0] : undefined
}

describe('self-host compose: the app port (ADEV-105)', () => {
  const ports = compose.services.app.ports ?? []

  it('ADEV-105: the app is published on 127.0.0.1 by default, so Caddy cannot be bypassed', () => {
    expect(ports.length).toBeGreaterThan(0)
    for (const mapping of ports) {
      expect(bindAddress(mapping), `app port "${mapping}" binds every interface`).toBe('127.0.0.1')
    }
  })

  it('ADEV-105: the bind address is the operator\'s to change (APP_BIND)', () => {
    for (const mapping of ports) expect(mapping).toMatch(/^\$\{APP_BIND:-127\.0\.0\.1\}:/)
  })

  it('ADEV-105: Caddy, the public entrance under --profile tls, still publishes 80 and 443', () => {
    expect(compose.services.caddy.profiles).toEqual(['tls'])
    expect(compose.services.caddy.ports).toEqual(expect.arrayContaining(['80:80', '443:443']))
  })

  it('ADEV-105: .env.example and the guide say how to expose the app without a proxy', () => {
    const example = read('deploy/self-host/.env.example')
    expect(example).toMatch(/^# APP_BIND=0\.0\.0\.0/m)
    expect(read('docs/deployment/SELF_HOSTING.md')).toContain('APP_BIND=0.0.0.0')
  })

  it('ADEV-105: .env.example gives POSTGRES_PASSWORD a URL-safe generator and says why', () => {
    const example = read('deploy/self-host/.env.example')
    const block = example.slice(0, example.indexOf('POSTGRES_PASSWORD='))
    const comment = block.split('\n').slice(-4).join('\n')
    expect(comment).toContain('openssl rand -hex 16')
    expect(comment).toMatch(/URL/)
  })
})
