/**
 * Run a GitHub Actions step's `run:` block for real, the way the runner does.
 *
 * A `toContain` on a step's YAML proves the text was typed, not that the
 * script behaves. These helpers pull one step out of a workflow by name and
 * execute it under the runner's default shell for `run:` on Linux
 * (`bash --noprofile --norc -eo pipefail {0}`), so errexit and pipefail bite
 * here exactly as they would in CI.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

export interface WorkflowStep {
  name?: string
  if?: string
  run?: string
  env?: Record<string, string>
  [key: string]: unknown
}

/** The named step of `job` in the workflow at `path`; throws if it is missing. */
export function workflowStep(path: string, job: string, name: string): WorkflowStep {
  const workflow = yaml.load(readFileSync(path, 'utf8'))
  const step = (workflow.jobs[job].steps as WorkflowStep[]).find(s => s.name === name)
  if (!step) throw new Error(`${path}: job ${job} has no step named "${name}"`)
  return step
}

export interface StepResult {
  status: number | null
  stdout: string
  stderr: string
}

/**
 * Execute the step's `run:` in `cwd`. `env` stands in for what the workflow
 * supplies through `${{ }}` (job env, github context); the step's own literal
 * `env:` entries are applied on top, and an expression-valued one must be
 * given in `env` or the call throws rather than run with a missing variable.
 */
export function runWorkflowStep(step: WorkflowStep, opts: { cwd: string; env?: Record<string, string> }): StepResult {
  if (!step.run) throw new Error(`step "${step.name}" has no run: block`)
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env }
  for (const [key, value] of Object.entries(step.env ?? {})) {
    if (String(value).includes('${{')) {
      if (opts.env?.[key] === undefined) throw new Error(`step "${step.name}" needs ${key} (${value})`)
    } else {
      env[key] = String(value)
    }
  }
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run], {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}
