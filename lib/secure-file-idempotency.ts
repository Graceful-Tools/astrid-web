import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Shared idempotency helpers for the SecureFile upload routes.
 *
 * The iOS Outbox replays an upload on retry with the same `clientRequestId`, so
 * the upload endpoints must return the already-created file instead of making a
 * duplicate. `clientRequestId` is additive/nullable — legacy (non-Outbox)
 * uploads pass null and behave exactly as before.
 */

/** Pull a string clientRequestId out of an upload context, if present. */
export function clientRequestIdFromContext(context: unknown): string | null {
  if (context && typeof context === 'object' && 'clientRequestId' in context) {
    const value = (context as Record<string, unknown>).clientRequestId
    return typeof value === 'string' && value.length > 0 ? value : null
  }
  return null
}

/** Existing SecureFile for this idempotency key, or null. */
export async function findSecureFileByClientRequestId(clientRequestId: string | null) {
  if (!clientRequestId) return null
  return prisma.secureFile.findUnique({ where: { clientRequestId } })
}

/** True when a create failed because another concurrent retry won the race. */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
