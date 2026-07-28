import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from "next/server"
import { getAuthenticationOptions, storeChallenge } from "@/lib/webauthn"
import { v4 as uuid } from "uuid"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.webauthn.authenticate.options')


export async function POST(request: NextRequest) {
  const blocked = capabilityGate('authPasskey')
  if (blocked) return blocked

  try {
    const body = await request.json().catch(() => ({}))
    const { email } = body

    // Get authentication options (optionally filtered by email)
    const options = await getAuthenticationOptions(email)

    // Store challenge for verification
    const sessionId = uuid()
    await storeChallenge(sessionId, {
      challenge: options.challenge,
      email: email?.toLowerCase(),
    })

    return NextResponse.json({
      options,
      sessionId,
    })
  } catch (error) {
    log.error({ err: error }, "[WebAuthn] Authentication options error:")
    return NextResponse.json(
      { error: "Failed to generate authentication options" },
      { status: 500 }
    )
  }
}
