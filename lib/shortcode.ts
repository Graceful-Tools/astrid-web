/**
 * Shortcode generation and management utilities
 * Creates short, shareable URLs for tasks and lists
 */

import { BRAND } from '@/lib/brand/config'
import { prisma } from "@/lib/prisma"
import { customAlphabet } from "nanoid"
import { createLogger } from '@/lib/logger'

const log = createLogger('shortcode')


const SHORTCODE_LENGTH = 8
const SHORTCODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const nanoid = customAlphabet(SHORTCODE_ALPHABET, SHORTCODE_LENGTH)

export type ShortcodeTargetType = "task" | "list"

export interface CreateShortcodeParams {
  targetType: ShortcodeTargetType
  targetId: string
  userId: string
  expiresAt?: Date
}

export interface ShortcodeData {
  id: string
  code: string
  targetType: string
  targetId: string
  userId: string
  clicks: number
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
  isActive: boolean
}

/**
 * Generate a unique shortcode
 * Uses nanoid with custom alphabet for cryptographically strong random codes
 * Only uses alphanumeric characters (0-9, A-Z, a-z)
 */
export function generateShortcode(): string {
  return nanoid()
}

/**
 * Create a new shortcode for a task or list
 * If a shortcode already exists for this target, returns existing code
 */
export async function createShortcode(
  params: CreateShortcodeParams
): Promise<ShortcodeData> {
  const { targetType, targetId, userId, expiresAt } = params

  // Check if active shortcode already exists for this target
  const existing = await prisma.shortcode.findFirst({
    where: {
      targetType,
      targetId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    },
    orderBy: {
      createdAt: "desc"
    }
  })

  if (existing) {
    return existing
  }

  // Generate unique code (retry if collision)
  let code = generateShortcode()
  let attempts = 0
  const maxAttempts = 5

  while (attempts < maxAttempts) {
    const collision = await prisma.shortcode.findUnique({
      where: { code }
    })

    if (!collision) break

    code = generateShortcode()
    attempts++
  }

  if (attempts >= maxAttempts) {
    throw new Error("Failed to generate unique shortcode")
  }

  // Create shortcode
  const shortcode = await prisma.shortcode.create({
    data: {
      code,
      targetType,
      targetId,
      userId,
      expiresAt: expiresAt || null
    }
  })

  return shortcode
}

/**
 * Resolve a shortcode to its target
 * Increments click counter and validates expiration
 */
export async function resolveShortcode(
  code: string
): Promise<{ targetType: string; targetId: string } | null> {
  const shortcode = await prisma.shortcode.findUnique({
    where: { code }
  })

  if (!shortcode) {
    return null
  }

  // Check if expired
  if (shortcode.expiresAt && shortcode.expiresAt < new Date()) {
    return null
  }

  // Check if active
  if (!shortcode.isActive) {
    return null
  }

  // Increment click counter (non-blocking)
  prisma.shortcode
    .update({
      where: { code },
      data: { clicks: { increment: 1 } }
    })
    .catch((err) => {
      log.error({ err: err }, "Failed to increment shortcode clicks:")
    })

  return {
    targetType: shortcode.targetType,
    targetId: shortcode.targetId
  }
}

/**
 * Get all shortcodes for a specific target
 */
export async function getShortcodesForTarget(
  targetType: ShortcodeTargetType,
  targetId: string
): Promise<ShortcodeData[]> {
  return prisma.shortcode.findMany({
    where: {
      targetType,
      targetId,
      isActive: true
    },
    orderBy: {
      createdAt: "desc"
    }
  })
}

/**
 * Deactivate a shortcode
 */
export async function deactivateShortcode(
  code: string,
  userId: string
): Promise<boolean> {
  const shortcode = await prisma.shortcode.findUnique({
    where: { code }
  })

  if (!shortcode || shortcode.userId !== userId) {
    return false
  }

  await prisma.shortcode.update({
    where: { code },
    data: { isActive: false }
  })

  return true
}

/**
 * Get shortcode analytics for a user
 */
export async function getShortcodeAnalytics(userId: string) {
  const shortcodes = await prisma.shortcode.findMany({
    where: {
      userId,
      isActive: true
    },
    orderBy: {
      clicks: "desc"
    }
  })

  const totalClicks = shortcodes.reduce((sum, sc) => sum + sc.clicks, 0)
  const totalShortcodes = shortcodes.length

  return {
    totalShortcodes,
    totalClicks,
    shortcodes
  }
}

/**
 * Build full shortcode URL
 * Uses current window location if available (for correct port in development)
 */
export function buildShortcodeUrl(code: string, baseUrl?: string): string {
  // Priority: 1. Provided baseUrl, 2. Window location (client-side), 3. Env var, 4. Default
  let base = baseUrl

  if (!base && typeof window !== 'undefined') {
    // Use current window location for correct port in development
    base = `${window.location.protocol}//${window.location.host}`
  }

  if (!base) {
    base = process.env.NEXT_PUBLIC_BASE_URL || `https://${BRAND.domain}`
  }

  return `${base}/s/${code}`
}
