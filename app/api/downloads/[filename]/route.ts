import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

import { queueWorkflowDownload } from '@/lib/agent-skill/astrid-queue-skill'

// Static files that are allowed to be downloaded
const ALLOWED_FILES: Record<string, { path: string; contentType: string }> = {
  'get-project-tasks-oauth.ts': {
    path: 'public/get-project-tasks-oauth.ts',
    contentType: 'text/plain',
  },
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  // The workflow document is generated from the canonical queue skill rather
  // than served from a hand-mirrored file, so it cannot drift (AWTD-763).
  if (filename === 'ASTRID_WORKFLOW.md') {
    return new NextResponse(queueWorkflowDownload(new URL(request.url).origin), {
      headers: {
        'Content-Type': 'text/markdown',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  const fileConfig = ALLOWED_FILES[filename]
  if (!fileConfig) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  try {
    const filePath = path.join(process.cwd(), fileConfig.path)
    const content = fs.readFileSync(filePath, 'utf-8')

    return new NextResponse(content, {
      headers: {
        'Content-Type': fileConfig.contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
