/**
 * Running git without mistaking "could not run it" for "it said no".
 *
 * Several checks shell out to git to decide what a CLEAN CHECKOUT contains —
 * which files are tracked, which paths are gitignored. Their answers get
 * committed (`docs/SCRIPT_INVENTORY.md`) or gate a deploy, so an answer
 * computed without git is worse than no answer: it is a per-machine result
 * wearing the authority of a checked-in document.
 *
 * Three outcomes have to stay distinct (task cea0ddf5):
 *
 *   - **answered** — git ran and exited, zero or not. `check-ignore` exits 1
 *     for "nothing matched" and 128 for "not a git repository"; both are git
 *     telling the caller something.
 *   - **unavailable** — there is no git to run, or no repository under it.
 *     Legitimately falls back to whatever the caller does without git.
 *   - **transient** — the machine refused the fork. Under the load the other
 *     repo's build produces (348 on 8 cores, measured) `fork(2)` returns
 *     EAGAIN. Nothing is wrong with the repository and a retry moments later
 *     works, so this must never reach a caller as data.
 *
 * Node reports a failed spawn as `status: null` with an errno string in
 * `code`, never as `status: undefined` — a guard written against `undefined`
 * silently reclassifies the whole transient case as an answer, which is how
 * `git check-ignore failed (exit null)` reached a predeploy report.
 */
import type { execFileSync as ExecFileSync } from "node:child_process"

/**
 * Required lazily so that merely importing this module pulls in no node
 * builtin — `doc-code-paths.ts` deliberately keeps its own module load free of
 * them, and a static import here would reintroduce one through the back door.
 */
function defaultExec(): typeof ExecFileSync {
   
  return (require("node:child_process") as typeof import("node:child_process")).execFileSync
}

/** Errnos that mean "not now", not "not possible". */
const TRANSIENT_CODES = new Set([
  "EAGAIN", // fork refused: process table or per-user limit exhausted
  "ENOMEM",
  "EMFILE",
  "ENFILE",
  "ETIMEDOUT",
  "EBUSY",
  "EINTR",
])

export type GitErrorKind =
  | { kind: "answered"; status: number; stderr: string }
  | { kind: "transient"; code: string }
  | { kind: "unavailable"; code: string }

/**
 * Which of the three outcomes an `execFileSync` rejection represents.
 *
 * Exported because it is the whole of the bug: every caller that hand-rolled
 * this got the `status: null` case wrong in a different way.
 */
export function classifyGitError(error: unknown): GitErrorKind {
  const status = (error as { status?: number | null }).status
  if (typeof status === "number") {
    return { kind: "answered", status, stderr: String((error as { stderr?: unknown }).stderr ?? "").trim() }
  }

  const code = String((error as { code?: unknown }).code ?? "UNKNOWN")
  return TRANSIENT_CODES.has(code) ? { kind: "transient", code } : { kind: "unavailable", code }
}

/** Raised when git never got to run, so there is no answer to report. */
export class GitUnrunnableError extends Error {
  constructor(
    readonly args: string[],
    readonly code: string,
    readonly attempts: number
  ) {
    super(
      `git ${args.join(" ")} could not be started after ${attempts} attempt(s) (${code}). ` +
        `This is NOT a repository problem: the machine could not fork a process, ` +
        `usually because another build is running concurrently. Re-run when it is quieter.`
    )
    this.name = "GitUnrunnableError"
  }
}

export type GitResult =
  | { ok: true; stdout: string }
  | { ok: false; status: number; stderr: string }
  /** No git binary, or nothing it recognises as a repository. */
  | { ok: false; status: null; code: string }

export interface RunGitOptions {
  input?: string
  maxBuffer?: number
  /** Total tries, including the first. */
  attempts?: number
  retryDelayMs?: number
  /**
   * How to spawn git. Defaults to `execFileSync`; a test supplies the errno
   * shapes a loaded machine produces, which cannot be provoked on demand.
   * Module-level mocking is not an option here — vitest externalises
   * `scripts/lib/`, so a `vi.mock` of `node:child_process` never reaches it.
   */
  exec?: typeof ExecFileSync
}

/** Busy-wait: these callers are synchronous, and the wait is milliseconds. */
function sleepSync(ms: number): void {
  if (ms <= 0) return
  const until = Date.now() + ms
  while (Date.now() < until) {
    /* deliberately spinning; a fork-starved machine has nothing to yield to */
  }
}

/**
 * Run git, retrying only the failures that a retry can fix.
 *
 * Throws {@link GitUnrunnableError} rather than returning, because there is no
 * value that honestly represents "the question was never asked" — and every
 * caller that invented one produced a wrong answer under load.
 */
export function runGit(root: string, args: string[], options: RunGitOptions = {}): GitResult {
  const attempts = options.attempts ?? 3
  const retryDelayMs = options.retryDelayMs ?? 150
  const exec = options.exec ?? defaultExec()
  let lastTransientCode = "UNKNOWN"

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const stdout = exec("git", args, {
        cwd: root,
        encoding: "utf8",
        input: options.input,
        stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
      })
      return { ok: true, stdout: String(stdout) }
    } catch (error) {
      const classified = classifyGitError(error)
      if (classified.kind === "answered") {
        return { ok: false, status: classified.status, stderr: classified.stderr }
      }
      if (classified.kind === "unavailable") {
        return { ok: false, status: null, code: classified.code }
      }
      lastTransientCode = classified.code
      // Back off a little further each time; the contention is another
      // process's build, which clears on its own timescale.
      if (attempt < attempts) sleepSync(retryDelayMs * attempt)
    }
  }

  throw new GitUnrunnableError(args, lastTransientCode, attempts)
}
