/**
 * GitHub Copilot SDK provider.
 *
 * Uses GitHub's supported SDK with a per-user OAuth token. The client runs in
 * empty mode so a multi-user web process exposes only the tools Astrid
 * explicitly registers—never ambient filesystem or shell capabilities.
 */

import { CopilotClient, RuntimeConnection, defineTool } from '@github/copilot-sdk'
import type { AIProviderResponse } from './types'
import type { OpenAIProviderOptions } from './openai-provider'
import { OPENAI_REPOSITORY_TOOLS } from './openai-provider'

export const COPILOT_REPOSITORY_TOOLS = OPENAI_REPOSITORY_TOOLS

export interface CopilotToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  handler: (input: Record<string, unknown>) => Promise<unknown>
}

export interface CopilotProviderOptions extends Omit<OpenAIProviderOptions, 'baseUrl' | 'extraHeaders'> {
  systemPrompt?: string
  tools?: CopilotToolDefinition[]
}

function repositoryToolDefinitions(options: CopilotProviderOptions): CopilotToolDefinition[] {
  if (!options.hasRepository || !options.executeToolCallback) return []
  return COPILOT_REPOSITORY_TOOLS.map(({ function: tool }) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as Record<string, unknown>,
    handler: input => options.executeToolCallback!(tool.name, input),
  }))
}

export async function callCopilot(options: CopilotProviderOptions): Promise<AIProviderResponse> {
  const toolDefinitions = options.tools ?? repositoryToolDefinitions(options)
  const runtimeUrl = process.env.COPILOT_CLI_URL
  const client = new CopilotClient({
    mode: 'empty',
    ...(runtimeUrl ? { connection: RuntimeConnection.forUri(runtimeUrl) } : {}),
    gitHubToken: options.apiKey,
    useLoggedInUser: false,
    workingDirectory: '/tmp',
    baseDirectory: '/tmp/astrid-copilot-sdk',
    logLevel: 'error',
  })

  await client.start()
  let session: Awaited<ReturnType<CopilotClient['createSession']>> | undefined
  try {
    const tools = toolDefinitions.map(tool => defineTool(tool.name, {
      description: tool.description,
      parameters: tool.parameters as never,
      handler: tool.handler,
    }))
    session = await client.createSession({
      model: options.model ?? 'gpt-4.1',
      gitHubToken: options.apiKey,
      skipEmbeddingRetrieval: true,
      systemMessage: {
        mode: 'append',
        content: options.systemPrompt ?? (options.jsonOnly
          ? 'Return only valid JSON, with no markdown or explanatory text.'
          : 'You are an expert software developer helping with Astrid tasks.'),
      },
      tools,
      availableTools: tools.map(tool => `custom:${tool.name}`),
      skipCustomInstructions: true,
    })

    const response = await session.sendAndWait({ prompt: options.prompt }, 60_000)
    const content = response?.data.content?.trim()
    if (!content) throw new Error('GitHub Copilot returned an empty response')
    return { content }
  } finally {
    await session?.disconnect().catch(() => undefined)
    await client.stop().catch(() => undefined)
  }
}

const copilotProvider = {
  name: 'copilot' as const,
  call: callCopilot,
  repositoryTools: COPILOT_REPOSITORY_TOOLS,
}

export default copilotProvider
