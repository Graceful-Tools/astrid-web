/**
 * A full-suite run intermittently lost whole test FILES to
 * `[vitest-pool]: Failed to start forks worker`, and vitest counts a file it
 * could not start as a failure.
 *
 * That is the worst possible failure mode for a gate: the run comes back red,
 * naming files that pass in isolation, so the reader goes looking for a bug in
 * code that is fine. Two consecutive runs of the same commit disagreed about
 * which files failed — one was fully green, one named two unrelated files —
 * which is the signature of resource exhaustion rather than a real defect.
 *
 * Vitest defaults `maxForks` to the CPU count, and each fork loads this app's
 * whole module graph plus a jsdom environment. Eight of those on a 24 GB
 * machine that is also running an editor and a browser is where it tips over.
 *
 * The bound is deliberately not 1: serialising the suite would trade flakiness
 * for a runtime nobody waits through, which is how gates get skipped.
 */

import { describe, it, expect } from 'vitest'
import os from 'os'
import config from '../../vitest.config'

describe('the worker pool leaves headroom', () => {
  const test = (config as { test?: Record<string, unknown> }).test ?? {}

  it('bounds maxWorkers instead of taking every core', () => {
    // Vitest 4 spelling. The Vitest 3 form (poolOptions.forks.maxForks) no
    // longer type-checks, and setting it would silently do nothing.
    expect(test.maxWorkers).toBeTypeOf('number')
    expect(test.maxWorkers as number).toBeGreaterThan(1)
  })

  it('claims at most half the cores, leaving room for a fork to boot', () => {
    // Vitest allows a worker a hardcoded 60s to report "started". Booting N
    // forks that each load this module graph, on a box that also runs CI
    // runners and a simulator, is what pushes some past it — and a worker that
    // misses it is reported as a FAILING test file.
    expect(test.maxWorkers as number).toBeLessThanOrEqual(Math.floor(os.cpus().length / 2))
  })

  it('keeps isolation on, so the bound cannot be mistaken for a licence to share state', () => {
    // `isolate: false` is the other way to cut memory, and it is a much larger
    // change: module-scope state would start outliving the file that set it.
    // Several suites here already depend on isolation.
    expect(test.isolate).not.toBe(false)
  })
})
