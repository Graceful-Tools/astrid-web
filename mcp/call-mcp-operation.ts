/**
 * Delegate a GitHub-style MCP operation to the web app's API.
 *
 * The MCP server keeps task/list/comment operations in-process (direct
 * Prisma calls) but punts repository operations (read file, list files,
 * create branch, commit, PR open/merge/comment, repository info) over to
 * /api/mcp/operations so the web app's GitHub auth + permission scoping
 * stays the single source of truth. This module wraps that delegation.
 *
 * Returns the MCP "content" envelope expected by the SDK; throws on
 * non-2xx so the surrounding switch/case can convert to an MCP error.
 */
async function callMCPOperation(operation: string, args: any) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

  try {
    const response = await fetch(`${apiUrl}/api/mcp/operations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operation, args }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || `API error: ${response.statusText}`)
    }

    const data = await response.json()
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    }
  } catch (error) {
    throw new Error(`Failed to call MCP operation ${operation}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

module.exports = { callMCPOperation }
