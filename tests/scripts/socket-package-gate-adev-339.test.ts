/**
 * ADEV-339: no npm package version is installed unless Socket has analyzed it and reports no
 * blocking risk. The gate fails closed: every way of not knowing is a refusal.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CANARY,
  addedPackages,
  checkPackages,
  judge,
  lockfilePackages,
  purl,
  specProblem,
} from '@/scripts/lib/socket-package-gate.mjs'

const SCORE = { license: 1, maintenance: 0.9, overall: 0.9, quality: 0.9, supplyChain: 0.95, vulnerability: 1 }
const artifact = (name: string, version: string, extra: Record<string, unknown> = {}) => {
  const scoped = /^(@[^/]+)\/(.+)$/.exec(name)
  return { type: 'npm', ...(scoped ? { namespace: scoped[1], name: scoped[2] } : { name }), version, score: SCORE, alerts: [], ...extra }
}
const canaryLine = artifact(CANARY.name, CANARY.version)
const ndjson = (...lines: unknown[]) => lines.map((line) => JSON.stringify(line)).join('\n')
const respond = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status, headers: status === 429 ? { 'retry-after': '120' } : {} })) as unknown as typeof fetch
const options = (fetchImpl: typeof fetch) => ({ token: 't', org: 'acme', fetchImpl })

describe('which package versions a change adds', () => {
  const lock = (packages: Record<string, unknown>) => lockfilePackages({ packages } as never)

  it('reads installed packages, nested and scoped, and skips the root, workspaces and links', () => {
    const packages = lock({
      '': { name: 'app', version: '1.0.0' },
      'packages/sdk': { name: '@acme/sdk', version: '1.0.0' },
      'node_modules/@acme/sdk': { resolved: 'packages/sdk', link: true },
      'node_modules/left-pad': { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz' },
      'node_modules/a/node_modules/@scope/b': { version: '2.0.0' },
    })
    expect([...packages.keys()].sort()).toEqual(['@scope/b@2.0.0', 'left-pad@1.3.0'])
  })

  it('reports only versions the base lockfile does not have, transitive ones included', () => {
    const base = lock({ 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '1.0.0' } })
    const head = lock({ 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '1.1.0' }, 'node_modules/b/node_modules/c': { version: '3.0.0' } })
    expect(addedPackages(base, head).map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual(['b@1.1.0', 'c@3.0.0'])
  })

  it('writes scoped names as Socket expects them', () => {
    expect(purl({ name: '@gracefultools/astrid-sdk', version: '1.0.3' })).toBe('pkg:npm/%40gracefultools/astrid-sdk@1.0.3')
  })
})

describe('deps:add accepts registry names only', () => {
  it.each(['left-pad', 'left-pad@1.3.0', '@scope/name@^2', 'next@latest'])('accepts %s', (spec) => {
    expect(specProblem(spec)).toBeNull()
  })
  it.each(['git+https://github.com/a/b.git', 'https://example.com/x.tgz', 'a/b', './local', 'alias@npm:other@1', 'x@github:a/b', '../x'])(
    'refuses %s',
    (spec) => {
      expect(specProblem(spec)).toMatch(/not a registry/)
    },
  )
})

describe('judging Socket’s answer', () => {
  const pkg = { name: 'thing', version: '1.0.0', resolved: 'https://registry.npmjs.org/thing/-/thing-1.0.0.tgz' }
  const verdict = (...lines: unknown[]) => judge([pkg], lines)[0]

  it('passes an analyzed version with only low-risk alerts', () => {
    const result = verdict(artifact('thing', '1.0.0', { alerts: [{ type: 'filesystemAccess', severity: 'low', category: 'supplyChainRisk', action: 'ignore' }] }))
    expect(result).toEqual({ package: 'thing@1.0.0', ok: true, reasons: [] })
  })

  it.each([
    ['known malware', { type: 'malware', severity: 'critical', category: 'supplyChainRisk' }, /malware/],
    ['AI-detected malware, even when only a warning', { type: 'gptMalware', severity: 'middle', category: 'supplyChainRisk', action: 'warn' }, /gptMalware \(always blocked\)/],
    ['a possible typosquat', { type: 'didYouMean', severity: 'middle', category: 'supplyChainRisk' }, /didYouMean/],
    ['anything the Socket policy marks error', { type: 'installScripts', severity: 'middle', category: 'supplyChainRisk', action: 'error' }, /security policy/],
    ['a critical alert in any category', { type: 'criticalCVE', severity: 'critical', category: 'vulnerability' }, /critical severity/],
    ['a high supply-chain alert', { type: 'obfuscatedFile', severity: 'high', category: 'supplyChainRisk' }, /high supply-chain risk/],
  ])('refuses %s', (_label, alert, reason) => {
    const result = verdict(artifact('thing', '1.0.0', { alerts: [alert] }))
    expect(result.ok).toBe(false)
    expect(result.reasons.join('; ')).toMatch(reason)
  })

  it.each([
    ['Socket returned nothing for it', [] as unknown[]],
    ['analysis is still pending', [artifact('thing', '1.0.0', { alerts: [{ type: 'pendingScan' }] })]],
    ['Socket does not know the version', [artifact('thing', '1.0.0', { alerts: [{ type: 'notFound' }] })]],
    ['the answer has no score', [artifact('thing', '1.0.0', { score: undefined })]],
    ['Socket returned an error for it', [{ _type: 'purlError', value: { inputPurl: 'pkg:npm/thing@1.0.0', error: 'package not found' } }]],
  ])('refuses as not analyzed when %s', (_label, lines) => {
    const result = verdict(...lines)
    expect(result.ok).toBe(false)
    expect(result.reasons[0]).toMatch(/^not analyzed/)
  })

  it('refuses a version that does not come from the npm registry', () => {
    const [result] = judge([{ ...pkg, resolved: 'git+ssh://git@github.com/a/thing.git#abc' }], [artifact('thing', '1.0.0')])
    expect(result.ok).toBe(false)
    expect(result.reasons[0]).toMatch(/not from the npm registry/)
  })

  it('matches scoped packages however Socket spells the namespace', () => {
    const scoped = { name: '@scope/thing', version: '1.0.0' }
    expect(judge([scoped], [artifact('@scope/thing', '1.0.0')])[0].ok).toBe(true)
    expect(judge([scoped], [{ ...artifact('thing', '1.0.0'), namespace: '%40scope' }])[0].ok).toBe(true)
    expect(judge([scoped], [{ score: SCORE, alerts: [], inputPurl: 'pkg:npm/%40scope/thing@1.0.0' }])[0].ok).toBe(true)
  })
})

describe('asking Socket fails closed', () => {
  const packages = [{ name: 'thing', version: '1.0.0' }]

  it('asks nothing and passes when there is nothing new', async () => {
    const fetchImpl = respond('')
    expect(await checkPackages([], options(fetchImpl))).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses without a token or org, before any request', async () => {
    const fetchImpl = respond('')
    await expect(checkPackages(packages, { fetchImpl })).rejects.toThrow(/SOCKET_API_TOKEN and SOCKET_ORG_SLUG/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the canary and the packages as PURLs with the token, and returns the verdicts', async () => {
    const fetchImpl = respond(ndjson(canaryLine, artifact('thing', '1.0.0')))
    const verdicts = await checkPackages(packages, options(fetchImpl))
    expect(verdicts).toEqual([{ package: 'thing@1.0.0', ok: true, reasons: [] }])
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.socket.dev/v0/orgs/acme/purl?alerts=true&purlErrors=true&poll=true&timeoutSec=120')
    expect(init.headers.authorization).toBe('Bearer t')
    expect(JSON.parse(init.body)).toEqual({ components: [{ purl: 'pkg:npm/lodash@4.17.21' }, { purl: 'pkg:npm/thing@1.0.0' }] })
  })

  it.each([401, 429, 500])('refuses on HTTP %s', async (status) => {
    await expect(checkPackages(packages, options(respond('', status)))).rejects.toThrow(new RegExp(`HTTP ${status}`))
  })

  it('refuses an answer that does not include the canary analysis, even if the packages look clean', async () => {
    const fetchImpl = respond(ndjson(artifact('thing', '1.0.0')))
    await expect(checkPackages(packages, options(fetchImpl))).rejects.toThrow(/canary/)
  })

  it('refuses an empty 200', async () => {
    await expect(checkPackages(packages, options(respond('')))).rejects.toThrow(/canary/)
  })
})

// ADEV-339, cross-platform: every repo's package manager goes through the same gate.
import { cargoLockPackages, csprojPackages, versionCatalogPackages, packagesForFile } from '@/scripts/lib/socket-package-gate.mjs'

describe('cross-platform: Rust, Gradle and NuGet package versions', () => {
  const CARGO_LOCK = `version = 4

[[package]]
name = "astrid-android-contracts"
version = "0.1.0"

[[package]]
name = "serde"
version = "1.0.215"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"

[[package]]
name = "itoa"
version = "1.0.11"
source = "sparse+https://index.crates.io/"

[[package]]
name = "astrid-core"
version = "0.1.0"
source = "git+https://github.com/Graceful-Tools/astrid-core.git?rev=ccfe7f7#ccfe7f784a16"

[[package]]
name = "sketchy"
version = "0.2.0"
source = "git+https://github.com/someone/sketchy.git#deadbeef"
`

  it('reads crates.io packages from Cargo.lock, skips the workspace and our own git crates, and flags other git sources', () => {
    const found = [...cargoLockPackages(CARGO_LOCK).values()]
    expect(found.map((p) => `${p.name}@${p.version}`)).toEqual(['serde@1.0.215', 'itoa@1.0.11', 'sketchy@0.2.0'])
    expect(found.every((p) => p.ecosystem === 'cargo')).toBe(true)
    expect(found[2].notRegistry).toMatch(/someone\/sketchy/)
    expect(purl(found[0])).toBe('pkg:cargo/serde@1.0.215')
  })

  const CATALOG = `[versions]
kotlin = "2.1.0"
coreKtx = "1.15.0"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
okhttp = { module = "com.squareup.okhttp3:okhttp", version = "4.12.0" }
junit = "junit:junit:4.13.2"
compose-bom = { group = "androidx.compose", name = "compose-bom", version = "2024.12.01" }
compose-ui = { group = "androidx.compose.ui", name = "ui" }

[plugins]
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
`

  it('reads versioned libraries from a Gradle version catalog, all three notations, and skips BOM-managed ones', () => {
    const found = [...versionCatalogPackages(CATALOG).values()]
    expect(found.map((p) => `${p.name}@${p.version}`).sort()).toEqual([
      'androidx.compose:compose-bom@2024.12.01',
      'androidx.core:core-ktx@1.15.0',
      'com.squareup.okhttp3:okhttp@4.12.0',
      'junit:junit@4.13.2',
    ])
    expect(purl(found.find((p) => p.name === 'androidx.core:core-ktx')!)).toBe('pkg:maven/androidx.core/core-ktx@1.15.0')
  })

  it('reads PackageReference versions from a .csproj, attribute or element form', () => {
    const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Version="1.6.241114003" Include="Microsoft.WindowsAppSDK" />
    <PackageReference Include="xunit">
      <Version>2.9.2</Version>
    </PackageReference>
    <ProjectReference Include="..\\Astrid.Core.Bindings\\Astrid.Core.Bindings.csproj" />
  </ItemGroup>
</Project>`
    const found = [...csprojPackages(csproj).values()]
    expect(found.map((p) => `${p.name}@${p.version}`)).toEqual(['Newtonsoft.Json@13.0.3', 'Microsoft.WindowsAppSDK@1.6.241114003', 'xunit@2.9.2'])
    expect(purl(found[0])).toBe('pkg:nuget/Newtonsoft.Json@13.0.3')
  })

  it('picks the parser by file name, and ignores files it does not know', () => {
    expect(packagesForFile('core/Cargo.lock', CARGO_LOCK).size).toBe(3)
    expect(packagesForFile('gradle/libs.versions.toml', CATALOG).size).toBe(4)
    expect(packagesForFile('app/Astrid.App/Astrid.App.csproj', '<PackageReference Include="A" Version="1.0.0" />').size).toBe(1)
    expect(packagesForFile('package-lock.json', JSON.stringify({ packages: { 'node_modules/a': { version: '1.0.0' } } })).size).toBe(1)
    expect(packagesForFile('README.md', '# hi').size).toBe(0)
  })

  it('matches Socket’s answers for each ecosystem, however it cases the name, and refuses a crate from someone else’s git', () => {
    const serde = { name: 'serde', version: '1.0.215', ecosystem: 'cargo' } as const
    const okhttp = { name: 'com.squareup.okhttp3:okhttp', version: '4.12.0', ecosystem: 'maven' } as const
    const json = { name: 'Newtonsoft.Json', version: '13.0.3', ecosystem: 'nuget' } as const
    const sketchy = { name: 'sketchy', version: '0.2.0', ecosystem: 'cargo', notRegistry: 'git+https://github.com/someone/sketchy.git' } as const
    const lines = [
      { type: 'cargo', name: 'serde', version: '1.0.215', score: SCORE, alerts: [{ type: 'installScripts', severity: 'middle', action: 'ignore' }] },
      { type: 'maven', namespace: 'com.squareup.okhttp3', name: 'okhttp', version: '4.12.0', score: SCORE, alerts: [] },
      { type: 'nuget', name: 'newtonsoft.json', version: '13.0.3', score: SCORE, alerts: [] },
      { type: 'cargo', name: 'sketchy', version: '0.2.0', score: SCORE, alerts: [] },
    ]
    const verdicts = judge([serde, okhttp, json, sketchy], lines)
    expect(verdicts.map((v) => v.ok)).toEqual([true, true, true, false])
    expect(verdicts[3].reasons.join(' ')).toMatch(/not from the cargo registry/)
  })

  it('says a first-seen version is being analyzed and to re-run, rather than only "not analyzed"', () => {
    const fresh = { name: 'serde', version: '1.0.999', ecosystem: 'cargo' } as const
    const [verdict] = judge([fresh], [{ type: 'cargo', name: 'serde', version: '1.0.999', alerts: [{ type: 'pendingScan', severity: 'middle' }] }])
    expect(verdict.ok).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/re-run in a few minutes/)
  })
})
