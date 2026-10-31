import type { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import AstridMCPServerOAuth from "../../mcp/mcp-server-oauth"

export interface SessionEntry {
  transport: SSEServerTransport
  server: AstridMCPServerOAuth
  authSignature: string | null
  createdAt: number
}

const sessions = new Map<string, SessionEntry>()

export function storeSession(sessionId: string, entry: SessionEntry) {
  sessions.set(sessionId, entry)
}

export function getSession(sessionId: string) {
  return sessions.get(sessionId)
}

export function deleteSession(sessionId: string) {
  sessions.delete(sessionId)
}

export function allSessions() {
  return sessions
}
