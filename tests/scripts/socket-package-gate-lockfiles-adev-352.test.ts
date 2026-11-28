import { describe, expect, it } from 'vitest'
import { GATED_FILES, gradleLockfilePackages, nugetLockPackages, packagesForFile, purl } from '@/scripts/lib/socket-package-gate.mjs'

// ADEV-352 (astrid-android) and ADEV-353 (astrid-windows): both repos commit lockfiles, so the
// Socket gate reads every version a build resolves, not only the ones a version catalog or a
// .csproj declares.

const GRADLE_LOCKFILE = `# This is a Gradle generated file for dependency locking.
# Manual edits can break the build and are not advised.
# This file is expected to be part of source control.
androidx.activity:activity-compose:1.13.0=debugCompileClasspath,releaseRuntimeClasspath
com.squareup.okio:okio-jvm:3.9.1=debugRuntimeClasspath
androidx.activity:activity-compose:1.13.0=debugUnitTestRuntimeClasspath
org.rustls:rustls-platform-verifier:0.2.0=debugRuntimeClasspath
empty=androidJdkImage,lintChecks
`

describe('ADEV-352: Gradle lockfiles', () => {
  it('reads every pinned artifact, transitive ones included, once each, as Maven packages', () => {
    const found = [...gradleLockfilePackages(GRADLE_LOCKFILE).values()]
    expect(found.map((p) => `${p.name}@${p.version}`)).toEqual([
      'androidx.activity:activity-compose@1.13.0',
      'com.squareup.okio:okio-jvm@3.9.1',
    ])
    expect(found.every((p) => p.ecosystem === 'maven')).toBe(true)
    expect(purl(found[1])).toBe('pkg:maven/com.squareup.okio/okio-jvm@3.9.1')
  })

  it('skips the rustls verifier, which comes from a crate the gate checks in Cargo.lock', () => {
    expect([...gradleLockfilePackages(GRADLE_LOCKFILE).keys()].some((key) => key.includes('rustls'))).toBe(false)
  })

  it('reads the project lockfiles and the plugin and settings lockfiles by name', () => {
    for (const path of ['app/gradle.lockfile', 'buildscript-gradle.lockfile', 'settings-gradle.lockfile']) {
      expect(packagesForFile(path, GRADLE_LOCKFILE).size).toBe(2)
    }
  })
})

const NUGET_LOCK = {
  version: 1,
  dependencies: {
    'net10.0': {
      xunit: { type: 'Direct', requested: '[2.9.3, )', resolved: '2.9.3', contentHash: 'x' },
      'xunit.core': { type: 'Transitive', resolved: '2.9.3', contentHash: 'y' },
      'Astrid.Core.Bindings': { type: 'Project' },
    },
    'net10.0/win-x64': {
      'xunit.core': { type: 'Transitive', resolved: '2.9.3', contentHash: 'y' },
      'System.Native': { type: 'Transitive', resolved: '4.3.0', contentHash: 'z' },
    },
  },
}

describe('ADEV-353: NuGet packages.lock.json', () => {
  it('reads direct and transitive packages across frameworks and runtimes, once each, and skips project references', () => {
    const found = [...nugetLockPackages(NUGET_LOCK).values()]
    expect(found.map((p) => `${p.name}@${p.version}`)).toEqual(['xunit@2.9.3', 'xunit.core@2.9.3', 'System.Native@4.3.0'])
    expect(found.every((p) => p.ecosystem === 'nuget')).toBe(true)
    expect(purl(found[0])).toBe('pkg:nuget/xunit@2.9.3')
  })

  it('reads packages.lock.json by name', () => {
    expect(packagesForFile('app/Astrid.App/packages.lock.json', JSON.stringify(NUGET_LOCK)).size).toBe(3)
  })
})

describe('ADEV-352/353: the gate reads lockfiles, not declarations', () => {
  it('tracks the lockfiles and no longer the version catalog or project files', () => {
    expect(GATED_FILES).toEqual(expect.arrayContaining(['**/*gradle.lockfile', '**/packages.lock.json']))
    expect(GATED_FILES.some((spec) => spec.includes('versions.toml') || spec.includes('csproj'))).toBe(false)
    expect(packagesForFile('gradle/libs.versions.toml', 'junit = "junit:junit:4.13.2"').size).toBe(0)
    expect(packagesForFile('app/A.csproj', '<PackageReference Include="A" Version="1.0.0" />').size).toBe(0)
  })
})
