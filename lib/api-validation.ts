import { NextResponse } from 'next/server'
import type { z } from 'zod'

export type ApiValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse<{ error: string }> }

function invalid(message: string): ApiValidationResult<never> {
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status: 400 }),
  }
}

function validate<T>(value: unknown, schema: z.ZodType<T>): ApiValidationResult<T> {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, data: result.data }
  return invalid(result.error.issues[0]?.message ?? 'Invalid request')
}

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ApiValidationResult<T>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return invalid('Invalid JSON body')
  }
  return validate(body, schema)
}

export async function parseRouteParams<T>(
  params: Promise<unknown>,
  schema: z.ZodType<T>,
): Promise<ApiValidationResult<T>> {
  return validate(await params, schema)
}

export function parseQueryParams<T>(
  searchParams: URLSearchParams,
  schema: z.ZodType<T>,
): ApiValidationResult<T> {
  const query: Record<string, string | string[]> = {}
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    query[key] = values.length === 1 ? values[0] : values
  }
  return validate(query, schema)
}
