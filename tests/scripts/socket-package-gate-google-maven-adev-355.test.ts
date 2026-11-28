import { describe, expect, it, vi } from 'vitest'
import { checkPackages, formatReport, gradleLockfilePackages } from '@/scripts/lib/socket-package-gate.mjs'

// ADEV-355 (Jon, 2026-11-28, option 1): Socket does not index Google's Maven repository, so the
// gate exempts Google Maven artifacts instead of refusing them, and relies on the sha256 pins in
// astrid-android's gradle/verification-metadata.xml. The exemption is reported, never silent.

const LOCKFILE = `# This is a Gradle generated file for dependency locking.
androidx.activity:activity:1.13.0=debugRuntimeClasspath
com.android.tools.build:aapt2:9.5.1-16666295=classpath
com.android:zipflinger:9.5.1=classpath
com.google.android.play:review:2.0.2=releaseRuntimeClasspath
com.google.testing.platform:core-proto:0.0.9-alpha03=classpath
com.google.guava:guava:33.4.0-jre=classpath
com.squareup.okio:okio-jvm:3.9.1=debugRuntimeClasspath
`

describe('ADEV-355: Google Maven is exempt, everything else is still checked', () => {
  it('marks androidx, com.android (the group itself and below it), com.google.android and com.google.testing.platform as exempt, and nothing else', () => {
    const found = [...gradleLockfilePackages(LOCKFILE).values()]
    const exempt = found.filter((p) => p.exempt).map((p) => p.name)
    expect(exempt).toEqual([
      'androidx.activity:activity',
      'com.android.tools.build:aapt2',
      'com.android:zipflinger',
      'com.google.android.play:review',
      'com.google.testing.platform:core-proto',
    ])
    // Maven Central artifacts from Google (guava) are not exempt: Socket covers them.
    expect(found.find((p) => p.name === 'com.google.guava:guava')?.exempt).toBeUndefined()
    expect(found.find((p) => p.name === 'androidx.activity:activity')?.exempt).toMatch(/Google Maven.*checksum/i)
  })

  it('does not ask Socket about exempt versions, and passes them with the reason recorded', async () => {
    const asked: string[] = []
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      asked.push(...JSON.parse(init.body).components.map((c: { purl: string }) => c.purl))
      const line = (name: string, version: string, type = 'npm', namespace?: string) =>
        JSON.stringify({ type, namespace, name, version, score: { supplyChain: 0.9 }, alerts: [] })
      return new Response([line('lodash', '4.17.21'), line('okio-jvm', '3.9.1', 'maven', 'com.squareup.okio')].join('\n'), { status: 200 })
    }) as unknown as typeof fetch
    const packages = [...gradleLockfilePackages(LOCKFILE).values()].filter((p) => p.name !== 'com.google.guava:guava')
    const verdicts = await checkPackages(packages, { token: 't', org: 'acme', fetchImpl })
    expect(asked.some((purl) => /androidx|com\.android|com\.google\.android|testing\.platform/.test(purl))).toBe(false)
    expect(verdicts.every((v) => v.ok)).toBe(true)
    expect(verdicts.filter((v) => v.exempt).length).toBe(5)
  })

  it('needs no token and makes no request when every new version is exempt', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const onlyGoogle = [...gradleLockfilePackages(LOCKFILE).values()].filter((p) => p.exempt)
    const verdicts = await checkPackages(onlyGoogle, { fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(verdicts.length).toBe(5)
  })

  it('lists exempt versions in the report', () => {
    const report = formatReport([
      { package: 'maven:androidx.activity:activity@1.13.0', ok: true, reasons: [], exempt: 'Google Maven' },
      { package: 'maven:com.squareup.okio:okio-jvm@3.9.1', ok: true, reasons: [] },
    ])
    expect(report).toMatch(/2 new package version\(s\) checked, 0 refused, 1 exempt/)
    expect(report).toMatch(/exempt.*androidx\.activity:activity@1\.13\.0/s)
  })
})
