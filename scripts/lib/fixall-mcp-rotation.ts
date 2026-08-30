export const FIXALL_AGENT_EMAIL = "copilot@astrid.cc"
export const FIXALL_REPOSITORIES = [
  "Graceful-Tools/astrid-web",
  "Graceful-Tools/astrid-ios",
] as const

export interface FixallMcpRotationOptions {
  mode: "dry-run" | "apply"
  databaseUrlEnv: string
  productionConfirmed: boolean
}

export interface FixallAgent {
  email: string
  isAIAgent: boolean
  isActive: boolean
}

export function parseFixallMcpRotationOptions(args: string[]): FixallMcpRotationOptions {
  let mode: FixallMcpRotationOptions["mode"] | undefined
  let databaseUrlEnv: string | undefined
  let productionConfirmed = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--dry-run" || arg === "--apply") {
      const nextMode = arg === "--dry-run" ? "dry-run" : "apply"
      if (mode && mode !== nextMode) throw new Error("Choose exactly one of --dry-run or --apply")
      mode = nextMode
    } else if (arg === "--database-url-env") {
      databaseUrlEnv = args[index + 1]
      index += 1
      if (!databaseUrlEnv || databaseUrlEnv.startsWith("--")) {
        throw new Error("--database-url-env requires an environment variable name")
      }
    } else if (arg === "--production") {
      productionConfirmed = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!mode) throw new Error("Choose exactly one of --dry-run or --apply")
  if (!databaseUrlEnv) throw new Error("--database-url-env is required")
  if (mode === "apply" && !productionConfirmed) {
    throw new Error("--apply requires --production")
  }

  return { mode, databaseUrlEnv, productionConfirmed }
}

export function validateFixallAgent(agent: FixallAgent | null): asserts agent is FixallAgent {
  if (!agent) throw new Error(`Required agent ${FIXALL_AGENT_EMAIL} does not exist`)
  if (agent.email.toLowerCase() !== FIXALL_AGENT_EMAIL) {
    throw new Error(`Refusing to rotate token for unexpected agent ${agent.email}`)
  }
  if (!agent.isAIAgent) throw new Error(`${FIXALL_AGENT_EMAIL} is not marked as an AI agent`)
  if (!agent.isActive) throw new Error(`${FIXALL_AGENT_EMAIL} is inactive`)
}

export async function propagateFixallMcpToken(
  plaintext: string,
  setRepositorySecret: (repository: string, plaintext: string) => Promise<void>,
  deactivateSupersededTokens: () => Promise<number>,
): Promise<number> {
  for (const repository of FIXALL_REPOSITORIES) {
    await setRepositorySecret(repository, plaintext)
  }
  return deactivateSupersededTokens()
}

export async function runSerializedFixallMcpRotation(
  plaintext: string,
  withRotationLock: <T>(operation: () => Promise<T>) => Promise<T>,
  activateStagedToken: () => Promise<void>,
  setRepositorySecret: (repository: string, plaintext: string) => Promise<void>,
  deactivateSupersededTokens: () => Promise<number>,
): Promise<number> {
  return withRotationLock(async () => {
    // A concurrent rotation that staged first may have retired this row before
    // this caller acquired the lock. Reactivate it before publishing its value.
    await activateStagedToken()
    return propagateFixallMcpToken(
      plaintext,
      setRepositorySecret,
      deactivateSupersededTokens,
    )
  })
}
