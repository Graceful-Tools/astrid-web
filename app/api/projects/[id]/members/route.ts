import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from "@/lib/logger"
import { sendProjectInvitationEmail } from "@/lib/email"
import { requireProjectsBeta } from "@/lib/feature-flags"
import {
  addProjectMember,
  inviteProjectMemberByEmail,
  getProjectMembers,
  cancelProjectInvite,
  updateProjectInviteRole,
} from "@/lib/projects-service"

const log = createLogger("api.projects.id.members")

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Evict the cached list set for every user whose access just changed. */
async function invalidateUserLists(userIds: Iterable<string>) {
  await Promise.all(
    Array.from(userIds).map((userId) =>
      RedisCache.del(RedisCache.keys.userLists(userId)).catch((error) =>
        log.error({ err: error }, `Failed to invalidate cache for user ${userId}:`),
      ),
    ),
  )
}

/**
 * GET /api/projects/:id/members — members + pending project invitations, in the
 * shape the sharing UI expects (mirrors GET /api/lists/:id/members). Any member
 * may view.
 */
export async function GET(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: projectId } = await context.params
    const result = await getProjectMembers(projectId, session.user.id)

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Project not found" }, { status: 404 })
      }
      return NextResponse.json(
        { error: "You do not have permission to view members" },
        { status: 403 },
      )
    }

    return NextResponse.json({ members: result.members, user_role: result.userRole })
  } catch (error) {
    log.error({ err: error }, "Error fetching project members:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * POST /api/projects/:id/members — share the project with an email (board #3).
 * If the email has an Astrid account → add them as a member immediately; else
 * create a PROJECT_SHARING invitation + email (reuses the invitation system).
 * Owner + project admins may add; only the owner may grant the admin role.
 */
export async function POST(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Sharing a project is a Beta-gated growth action.
    if (!(await requireProjectsBeta(session.user.id))) {
      return NextResponse.json({ error: "Projects is in beta. Enable it in Settings to share boards." }, { status: 403 })
    }

    const { id: projectId } = await context.params
    const body = await request.json().catch(() => ({}))
    const email = typeof body.email === "string" ? body.email : ""
    const role = body.role

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    // Existing-account path: add the member directly.
    const added = await addProjectMember(projectId, session.user.id, { email, role })

    if (!("error" in added)) {
      await invalidateUserLists(added.userIdsToInvalidate)
      return NextResponse.json({ member: added.member }, { status: 201 })
    }

    // No account for this email → fall back to an email invitation.
    if (added.error === "user_not_found") {
      const invite = await inviteProjectMemberByEmail(projectId, session.user.id, { email, role })
      if ("error" in invite) {
        switch (invite.error) {
          case "not_found":
            return NextResponse.json({ error: "Project not found" }, { status: 404 })
          case "forbidden":
            return NextResponse.json(
              { error: "You don't have permission to invite with this role" },
              { status: 403 },
            )
          default:
            return NextResponse.json({ error: invite.message }, { status: 400 })
        }
      }

      try {
        await sendProjectInvitationEmail({
          to: invite.email,
          inviterName: session.user.name || session.user.email || "Someone",
          projectName: invite.projectName,
          role: invite.role === "admin" ? "manager" : "member",
          invitationUrl: `${process.env.NEXTAUTH_URL}/invite/${invite.token}`,
        })
      } catch (emailError) {
        log.error({ err: emailError }, "Failed to send project invitation email:")
        // Invitation row exists regardless; email is best-effort.
      }

      return NextResponse.json({ invited: true, email: invite.email }, { status: 201 })
    }

    switch (added.error) {
      case "not_found":
        return NextResponse.json({ error: "Project not found" }, { status: 404 })
      case "forbidden":
        return NextResponse.json(
          { error: "You don't have permission to add members with this role" },
          { status: 403 },
        )
      default:
        return NextResponse.json({ error: added.message }, { status: 400 })
    }
  } catch (error) {
    log.error({ err: error }, "Error sharing project:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * DELETE /api/projects/:id/members — cancel a pending invitation by email.
 * (Removing an actual member uses DELETE /api/projects/:id/members/:userId.)
 */
export async function DELETE(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: projectId } = await context.params
    const body = await request.json().catch(() => ({}))
    const email = typeof body.email === "string" ? body.email : ""

    if (!body.isInvitation || !email) {
      return NextResponse.json(
        { error: "Provide { email, isInvitation: true } to cancel an invite; remove members via /members/:userId" },
        { status: 400 },
      )
    }

    const result = await cancelProjectInvite(projectId, session.user.id, email)
    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Invitation not found" }, { status: 404 })
      }
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.json({ message: "Invitation cancelled" })
  } catch (error) {
    log.error({ err: error }, "Error cancelling project invitation:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * PATCH /api/projects/:id/members — change a pending invitation's role by email.
 * (Re-roling an actual member uses PATCH /api/projects/:id/members/:userId.)
 */
export async function PATCH(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: projectId } = await context.params
    const body = await request.json().catch(() => ({}))
    const email = typeof body.email === "string" ? body.email : ""

    if (!body.isInvitation || !email) {
      return NextResponse.json(
        { error: "Provide { email, isInvitation: true, role } to re-role an invite; members via /members/:userId" },
        { status: 400 },
      )
    }

    const result = await updateProjectInviteRole(projectId, session.user.id, email, body.role)
    if ("error" in result) {
      switch (result.error) {
        case "not_found":
          return NextResponse.json({ error: "Invitation not found" }, { status: 404 })
        case "forbidden":
          return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        default:
          return NextResponse.json({ error: result.message }, { status: 400 })
      }
    }
    return NextResponse.json({ message: "Invitation role updated" })
  } catch (error) {
    log.error({ err: error }, "Error updating project invitation role:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
