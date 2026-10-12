/**
 * Screenshots on tasks over MCP.
 *
 * MCP had no way to attach a file: no tool took bytes and add_comment had no
 * fileId, so an agent with captured evidence could only paste a path on its
 * own machine — which nobody reading the task can open.
 *
 * The bytes deliberately do NOT travel as a tool argument. A 2400×1310 PNG is
 * ~650 KB of base64: model context, not data. This tool mints a short-lived
 * upload ticket and hands back the PUT the client runs itself (a ready curl
 * line); the server stores the image and posts it as an ATTACHMENT comment.
 * The routes own auth, access, type/size checks and idempotency — this is a
 * thin proxy. Kept out of `mcp-server-oauth.ts`, which is on the
 * oversized-files ratchet.
 */

import type { ChatRequester as Requester } from "./list-chat"

export const ATTACHMENT_TOOL_NAME = "create_task_attachment_upload"

export const ATTACHMENT_TOOLS = [
  {
    name: ATTACHMENT_TOOL_NAME,
    description:
      "Attach a screenshot/image (PNG, JPEG, GIF or WebP, max 4 MB) to a task as an attachment comment. Returns a short-lived (15 min) upload target; then PUT the raw file bytes to it — the response includes a ready `curl` command, replace the path placeholder with the local file. Do NOT base64 the image into a tool call. The image appears on the task like any comment attachment. Re-running the same PUT (or reusing clientRequestId) does not duplicate it.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task id (uuid) or identifier such as AWTD-1007" },
        fileName: { type: "string", description: "File name with extension, e.g. 01-context-menu.png" },
        mimeType: {
          type: "string",
          enum: ["image/png", "image/jpeg", "image/gif", "image/webp"],
          description: "Optional; derived from the extension when omitted",
        },
        caption: { type: "string", description: "Comment text shown with the image (max 1000 chars). Defaults to 'Attached: <fileName>'." },
        clientRequestId: { type: "string", description: "Optional idempotency key; the same key never posts the image twice" },
      },
      required: ["taskId", "fileName"],
      additionalProperties: false,
    },
  },
] as const

export function isAttachmentTool(name: string): boolean {
  return name === ATTACHMENT_TOOL_NAME
}

interface MintedUpload {
  upload: { method: string; url: string; headers: Record<string, string>; expiresAt: string; maxBytes: number }
  [key: string]: unknown
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

export async function callAttachmentTool(
  client: Requester,
  args: any,
  signature: { aiAgentId?: string },
) {
  const taskId = typeof args?.taskId === "string" ? args.taskId.trim() : ""
  if (!taskId) throw new Error("taskId is required")
  const fileName = typeof args?.fileName === "string" ? args.fileName.trim() : ""
  if (!fileName) throw new Error("fileName is required")

  const body: Record<string, unknown> = { fileName, ...signature }
  for (const key of ["mimeType", "caption", "clientRequestId"] as const) {
    if (args[key] !== undefined) body[key] = args[key]
  }

  const minted = await client.makeRequest<MintedUpload>(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/attachment-uploads`,
    { method: "POST", body: JSON.stringify(body) },
  )

  const { upload } = minted
  const curl = [
    "curl -sS --fail-with-body -X PUT",
    ...Object.entries(upload.headers).map(([k, v]) => `-H ${shellQuote(`${k}: ${v}`)}`),
    `--data-binary @${shellQuote(`<path-to-${fileName}>`)}`,
    shellQuote(upload.url),
  ].join(" ")

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            ...minted,
            next: "PUT the raw file bytes to upload.url with upload.headers before upload.expiresAt. A 201/200 response carries the attachment comment.",
            curl,
          },
          null,
          2,
        ),
      },
    ],
  }
}
