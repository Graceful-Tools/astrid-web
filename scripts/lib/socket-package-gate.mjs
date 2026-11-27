/**
 * ADEV-339: no package version is installed unless Socket (socket.dev) has analyzed it and
 * reports no blocking risk. Jon, 2026-11-27: "Let's not install packages with risk or that
 * haven't been analyzed." Cross-platform since 2026-11-27: npm (`package-lock.json`), Rust
 * (`Cargo.lock`), Gradle version catalogs (`libs.versions.toml`, Maven) and NuGet (`.csproj`),
 * so astrid-core, astrid-ios, astrid-android and astrid-windows run the same gate
 * (.github/workflows/socket-gate-reusable.yml).
 *
 * Plain ES module with no dependencies, on purpose: the PR check runs it BEFORE `npm ci`, so the
 * gate never depends on the packages it is judging.
 *
 * Fail closed. Every way of not knowing is a refusal, never a pass: no token, a non-200, a
 * package missing from the answer, a pending or not-found analysis, an answer with no score.
 * The canary below proves the endpoint is answering before any clean result is believed
 * (the lesson of AWTD-909, see scripts/audit-production-advisories.ts).
 */

export const SOCKET_API = 'https://api.socket.dev/v0'

/** A version Socket has certainly analyzed. If it does not come back scored, the answer is not trusted. */
export const CANARY = { name: 'lodash', version: '4.17.21' }

/** PURLs per request. The endpoint's limit is 1024; one request costs 100 quota units whatever its size. */
export const BATCH_SIZE = 500

/** Alert types that block whatever severity or policy action Socket attaches. */
export const ALWAYS_BLOCK_TYPES = new Set(['malware', 'gptMalware', 'didYouMean'])

/** Alert types Socket synthesizes when it has no finished analysis. */
export const UNANALYZED_TYPES = new Set(['pendingScan', 'notFound'])

const REGISTRY_PREFIX = 'https://registry.npmjs.org/'

/**
 * Registry names only: `name`, `name@1.2.3`, `@scope/name@^1`. A git URL, tarball URL, alias or
 * file path would install code Socket never saw under that name.
 * @param {string} spec
 * @returns {string | null} why the spec is refused, or null
 */
export function specProblem(spec) {
  const match = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*(?:@(.+))?$/.exec(spec)
  if (!match) return `"${spec}" is not a registry package name`
  const range = match[2]
  if (range !== undefined && /[:/\s]/.test(range)) return `"${spec}" is not a registry version (no URLs, git refs, aliases or paths)`
  return null
}

/**
 * @typedef {'npm' | 'cargo' | 'maven' | 'nuget'} Ecosystem
 * @typedef {{ name: string, version: string, resolved?: string, ecosystem?: Ecosystem, notRegistry?: string }} LockedPackage
 * `ecosystem` defaults to npm. A Maven name is `group:artifact`. `notRegistry` names a source
 * Socket's analysis of the registry version does not cover (someone else's git repo).
 */

/** The key a package is compared and matched by: its ecosystem, name and version, lowercased. */
export function packageKey(pkg) {
  return `${pkg.ecosystem ?? 'npm'}:${pkg.name}@${pkg.version}`.toLowerCase()
}

/**
 * Every installed package in a lockfile (v2/v3 `packages` map), keyed `name@version`.
 * Workspace members and links are the repo's own code and are skipped.
 * @param {{ packages?: Record<string, { version?: string, resolved?: string, link?: boolean, name?: string }> }} lock
 * @returns {Map<string, LockedPackage>}
 */
export function lockfilePackages(lock) {
  const found = new Map()
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const at = path.lastIndexOf('node_modules/')
    if (at < 0 || entry.link || !entry.version) continue
    const name = entry.name ?? path.slice(at + 'node_modules/'.length)
    found.set(`${name}@${entry.version}`, { name, version: entry.version, resolved: entry.resolved })
  }
  return found
}

/**
 * Package versions in `head` that `base` does not have: what a change would newly install.
 * @param {Map<string, LockedPackage>} base
 * @param {Map<string, LockedPackage>} head
 * @returns {LockedPackage[]}
 */
export function addedPackages(base, head) {
  return [...head].filter(([key]) => !base.has(key)).map(([, value]) => value).sort((a, b) => packageKey(a).localeCompare(packageKey(b)))
}

const CRATES_IO = new Set(['registry+https://github.com/rust-lang/crates.io-index', 'sparse+https://index.crates.io/'])
/** Our own crates (astrid-core by git pin) are our code, reviewed in our repos, not a dependency to vet. */
const OWN_GIT = /^git\+https:\/\/github\.com\/Graceful-Tools\//i

/**
 * Every crate a `Cargo.lock` resolves. Workspace members (no `source`) and our own git crates are
 * skipped; a crate from anyone else's git or registry is kept and flagged `notRegistry`.
 * @param {string} text
 * @returns {Map<string, LockedPackage>}
 */
export function cargoLockPackages(text) {
  const found = new Map()
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const field = (key) => new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm').exec(block)?.[1]
    const name = field('name')
    const version = field('version')
    const source = field('source')
    if (!name || !version || !source || OWN_GIT.test(source)) continue
    /** @type {LockedPackage} */
    const pkg = { name, version, ecosystem: 'cargo' }
    if (!CRATES_IO.has(source)) pkg.notRegistry = source.split('#')[0]
    found.set(packageKey(pkg), pkg)
  }
  return found
}

/**
 * Versioned libraries in a Gradle version catalog (`[libraries]`, with `[versions]` refs), as
 * Maven packages. A library without a version is BOM-managed: the BOM itself is checked, not it.
 * Plugins are not checked (the Gradle plugin portal is not a registry Socket covers).
 * @param {string} text
 * @returns {Map<string, LockedPackage>}
 */
export function versionCatalogPackages(text) {
  const sections = new Map()
  let current = ''
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) { current = header[1].trim(); continue }
    const entry = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line)
    if (entry) (sections.get(current) ?? sections.set(current, []).get(current)).push([entry[1], entry[2].trim()])
  }
  const versions = new Map((sections.get('versions') ?? []).map(([key, value]) => [key, /^"([^"]+)"$/.exec(value)?.[1]]))
  const found = new Map()
  for (const [, value] of sections.get('libraries') ?? []) {
    let group, artifact, version
    const plain = /^"([^":]+):([^":]+):([^":]+)"$/.exec(value)
    if (plain) [, group, artifact, version] = plain
    else {
      const prop = (key) => new RegExp(`(?:^|[{,\\s])${key.replace('.', '\\.')}\\s*=\\s*"([^"]+)"`).exec(value)?.[1]
      const coordinates = prop('module')
      if (coordinates) [group, artifact] = coordinates.split(':')
      else { group = prop('group'); artifact = prop('name') }
      version = prop('version') ?? versions.get(prop('version.ref') ?? '')
    }
    if (!group || !artifact || !version) continue
    /** @type {LockedPackage} */
    const pkg = { name: `${group}:${artifact}`, version, ecosystem: 'maven' }
    found.set(packageKey(pkg), pkg)
  }
  return found
}

/**
 * NuGet `PackageReference`s in a project file, with the version as an attribute or an element.
 * @param {string} text
 * @returns {Map<string, LockedPackage>}
 */
export function csprojPackages(text) {
  const found = new Map()
  for (const match of text.matchAll(/<PackageReference\b([^>]*?)(\/>|>([\s\S]*?)<\/PackageReference>)/g)) {
    const attrs = match[1]
    const name = /\bInclude="([^"]+)"/.exec(attrs)?.[1]
    const version = /\bVersion="([^"]+)"/.exec(attrs)?.[1] ?? /<Version>\s*([^<\s]+)\s*<\/Version>/.exec(match[3] ?? '')?.[1]
    if (!name || !version) continue
    /** @type {LockedPackage} */
    const pkg = { name, version, ecosystem: 'nuget' }
    found.set(packageKey(pkg), pkg)
  }
  return found
}

/** The files the gate reads, as git pathspecs. */
export const GATED_FILES = ['package-lock.json', '**/package-lock.json', 'Cargo.lock', '**/Cargo.lock', '**/libs.versions.toml', '*.csproj', '**/*.csproj']

/**
 * The packages a file declares, by its name; an unknown file declares none.
 * @param {string} path
 * @param {string} text
 * @returns {Map<string, LockedPackage>}
 */
export function packagesForFile(path, text) {
  const base = path.split('/').pop() ?? ''
  if (base === 'package-lock.json') return lockfilePackages(JSON.parse(text))
  if (base === 'Cargo.lock') return cargoLockPackages(text)
  if (base.endsWith('.versions.toml')) return versionCatalogPackages(text)
  if (base.endsWith('.csproj')) return csprojPackages(text)
  return new Map()
}

/** @param {LockedPackage} pkg */
export function purl({ name, version, ecosystem = 'npm' }) {
  if (ecosystem === 'maven') return `pkg:maven/${name.replace(':', '/')}@${version}`
  if (ecosystem === 'npm') return `pkg:npm/${name.replace(/^@/, '%40')}@${version}`
  return `pkg:${ecosystem}/${name}@${version}`
}

/** `pkg:npm/%40scope/name@1.0.0` and `pkg:npm/@scope/name@1.0.0` compare equal, in any case. */
function normalizeKey(value) {
  return decodeURIComponent(value).toLowerCase()
}

/** The purl an answer line describes, rebuilt from its parts. */
function linePurl(line) {
  const namespace = line.namespace ? decodeURIComponent(line.namespace) : ''
  const ns = namespace ? `${line.type === 'npm' ? namespace.replace(/^@?/, '@') : namespace}/` : ''
  return `pkg:${line.type ?? 'npm'}/${ns}${line.name}@${line.version}`
}

/** @param {string} text newline-delimited JSON */
export function parseNdjson(text) {
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
}

/**
 * @typedef {{ package: string, ok: boolean, reasons: string[] }} Verdict
 * Judge each requested package against Socket's answer lines.
 * @param {LockedPackage[]} requested
 * @param {any[]} lines parsed NDJSON from the purl endpoint
 * @returns {Verdict[]}
 */
export function judge(requested, lines) {
  const artifacts = new Map()
  const errors = new Map()
  for (const line of lines) {
    if (line?._type === 'purlError') {
      if (line.value?.inputPurl) errors.set(normalizeKey(line.value.inputPurl), line.value)
      continue
    }
    if (line?._type) continue
    if (line.name && line.version) artifacts.set(normalizeKey(linePurl(line)), line)
    if (line.inputPurl) artifacts.set(normalizeKey(line.inputPurl), line)
  }

  return requested.map((pkg) => {
    const ecosystem = pkg.ecosystem ?? 'npm'
    const label = ecosystem === 'npm' ? `${pkg.name}@${pkg.version}` : `${ecosystem}:${pkg.name}@${pkg.version}`
    const key = normalizeKey(purl(pkg))
    /** @type {string[]} */
    const reasons = []
    const foreign = pkg.notRegistry ?? (pkg.resolved !== undefined && !pkg.resolved.startsWith(REGISTRY_PREFIX) ? pkg.resolved : undefined)
    if (foreign !== undefined) {
      reasons.push(`not from the ${ecosystem} registry (${foreign.split('#')[0].slice(0, 80)}), so Socket's analysis does not cover it`)
    }
    const error = errors.get(key)
    const artifact = artifacts.get(key)
    if (error) {
      reasons.push(`not analyzed: ${error.error ?? 'Socket could not resolve it'}${error.retryable ? ' (transient, retry)' : ''}`)
    } else if (!artifact) {
      reasons.push('not analyzed: Socket returned nothing for this version')
    } else {
      const alerts = Array.isArray(artifact.alerts) ? artifact.alerts : []
      const unanalyzed = alerts.find((alert) => UNANALYZED_TYPES.has(alert.type))
      if (unanalyzed) {
        reasons.push(unanalyzed.type === 'pendingScan'
          ? 'not analyzed yet: Socket is analyzing this version for the first time; re-run in a few minutes'
          : `not analyzed: Socket reports ${unanalyzed.type}`)
      }
      else if (!artifact.score || typeof artifact.score.supplyChain !== 'number') reasons.push('not analyzed: Socket returned no score')
      for (const alert of alerts) {
        if (UNANALYZED_TYPES.has(alert.type)) continue
        const why =
          ALWAYS_BLOCK_TYPES.has(alert.type) ? 'always blocked'
          : alert.action === 'error' ? 'blocked by the Socket security policy'
          : alert.severity === 'critical' ? 'critical severity'
          : alert.severity === 'high' && alert.category === 'supplyChainRisk' ? 'high supply-chain risk'
          : null
        if (why) reasons.push(`${alert.type} (${why})`)
      }
    }
    return { package: label, ok: reasons.length === 0, reasons: [...new Set(reasons)] }
  })
}

/**
 * Ask Socket about `packages` and judge them. Throws when the question could not be asked or the
 * answer cannot be trusted; callers treat a throw as a refusal.
 * @param {LockedPackage[]} packages
 * @param {{ token?: string, org?: string, fetchImpl?: typeof fetch, timeoutSec?: number }} options
 * @returns {Promise<Verdict[]>}
 */
export async function checkPackages(packages, { token, org, fetchImpl = fetch, timeoutSec = 120 } = {}) {
  if (packages.length === 0) return []
  if (!token || !org) {
    throw new Error('SOCKET_API_TOKEN and SOCKET_ORG_SLUG are not both set, so nothing can be shown to be analyzed. Refusing.')
  }
  /** @type {Verdict[]} */
  const verdicts = []
  for (let start = 0; start < packages.length; start += BATCH_SIZE) {
    const batch = packages.slice(start, start + BATCH_SIZE)
    const asked = [CANARY, ...batch]
    const url = `${SOCKET_API}/orgs/${encodeURIComponent(org)}/purl?alerts=true&purlErrors=true&poll=true&timeoutSec=${timeoutSec}`
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify({ components: asked.map((pkg) => ({ purl: purl(pkg) })) }),
    })
    if (!response.ok) {
      const retry = response.headers?.get?.('retry-after')
      throw new Error(`Socket answered HTTP ${response.status}${response.status === 429 ? ` (quota; retry after ${retry ?? 'a while'}s)` : ''}. Refusing.`)
    }
    const [canary, ...rest] = judge(asked, parseNdjson(await response.text()))
    if (canary.reasons.some((reason) => reason.startsWith('not analyzed'))) {
      throw new Error(`Socket did not return an analysis for the canary ${canary.package}, so its answer is not trusted. Refusing.`)
    }
    verdicts.push(...rest)
  }
  return verdicts
}

/** @param {Verdict[]} verdicts */
export function formatReport(verdicts) {
  const blocked = verdicts.filter((verdict) => !verdict.ok)
  const lines = [`Socket gate: ${verdicts.length} new package version(s) checked, ${blocked.length} refused.`]
  for (const verdict of blocked) {
    lines.push(`  ✗ ${verdict.package}`)
    for (const reason of verdict.reasons) lines.push(`      - ${reason}`)
    const eco = /^(cargo|maven|nuget):/.exec(verdict.package)?.[1] ?? 'npm'
    const bare = verdict.package.replace(/^(cargo|maven|nuget):/, '')
    lines.push(`      https://socket.dev/${eco}/package/${bare.slice(0, bare.lastIndexOf('@'))}/overview/${bare.slice(bare.lastIndexOf('@') + 1)}`)
  }
  return lines.join('\n')
}
