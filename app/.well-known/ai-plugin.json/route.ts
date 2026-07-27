import { NextResponse } from 'next/server'
import { getBaseUrl } from '@/lib/base-url'
import { BRAND } from '@/lib/brand/config'

export async function GET() {
  const baseUrl = getBaseUrl()
  const manifest = {
    schema_version: 'v1',
    name_for_human: `${BRAND.appName} Tasks`,
    // Stable model-facing identifier: renaming it would break already-installed GPT
    // actions, so it stays `astridTasks` regardless of brand.
    name_for_model: 'astridTasks',
    description_for_human: `Create, review, and complete ${BRAND.appName} tasks directly from ChatGPT.`,
    description_for_model:
      `Use this tool to read ${BRAND.appName} task lists, create new tasks with titles and optional descriptions, and update tasks (including marking them complete). Always include helpful summaries when presenting results to the user.`,
    auth: {
      type: 'oauth',
      client_url: `${baseUrl}/settings/api-access`,
      scope: 'tasks:read tasks:write lists:read comments:write',
      authorization_url: `${baseUrl}/oauth/authorize`,
      token_url: `${baseUrl}/api/v1/oauth/token`,
      authorization_content_type: 'application/x-www-form-urlencoded',
    },
    api: {
      type: 'openapi',
      url: `${baseUrl}/.well-known/astrid-openapi.yaml`,
      is_user_authenticated: true,
    },
    logo_url: `${baseUrl}/apple-touch-icon.png`,
    contact_email: BRAND.supportEmail,
    legal_info_url: `${baseUrl}/privacy`,
  }

  return NextResponse.json(manifest, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=600',
    },
  })
}
