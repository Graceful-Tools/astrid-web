import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { getUserPasskeys, deletePasskey, renamePasskey } from "@/lib/webauthn"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.webauthn.passkeys')


export async function GET(request: NextRequest) {
  const blocked = capabilityGate('authPasskey')
  if (blocked) return blocked

  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      )
    }

    const passkeys = await getUserPasskeys(session.user.id)

    return NextResponse.json({ passkeys })
  } catch (error) {
    log.error({ err: error }, "[WebAuthn] Get passkeys error:")
    return NextResponse.json(
      { error: "Failed to get passkeys" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = capabilityGate('authPasskey')
  if (blocked) return blocked

  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const passkeyId = searchParams.get("id")

    if (!passkeyId) {
      return NextResponse.json(
        { error: "Passkey ID required" },
        { status: 400 }
      )
    }

    const result = await deletePasskey(session.user.id, passkeyId)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, "[WebAuthn] Delete passkey error:")
    return NextResponse.json(
      { error: "Failed to delete passkey" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const blocked = capabilityGate('authPasskey')
  if (blocked) return blocked

  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { id, name } = body

    if (!id || !name) {
      return NextResponse.json(
        { error: "Passkey ID and name required" },
        { status: 400 }
      )
    }

    const result = await renamePasskey(session.user.id, id, name)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, "[WebAuthn] Rename passkey error:")
    return NextResponse.json(
      { error: "Failed to rename passkey" },
      { status: 500 }
    )
  }
}
