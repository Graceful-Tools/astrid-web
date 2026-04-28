/**
 * Astrid Config Loader
 *
 * Loads .astrid.config.json from repository, merges with defaults,
 * and provides a resolved configuration object.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type {
  AstridConfig,
  ResolvedAstridConfig,
  ProjectStructure,
  PlatformDetection,
} from './schema'
import { CONFIG_DEFAULTS } from './defaults'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai.config.index')


// Re-export types and defaults
export * from './schema'
export { CONFIG_DEFAULTS } from './defaults'

// ============================================================================
// CONFIG CACHE
// ============================================================================

const configCache = new Map<string, ResolvedAstridConfig>()

/**
 * Clear the config cache (useful for testing)
 */
export function clearConfigCache(): void {
  configCache.clear()
}

// ============================================================================
// DEEP MERGE UTILITY
// ============================================================================

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item)
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }

  for (const key of Object.keys(source)) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (sourceValue === undefined) {
      continue
    }

    if (isObject(sourceValue) && isObject(targetValue)) {
      result[key] = deepMerge(targetValue, sourceValue)
    } else if (Array.isArray(sourceValue)) {
      // For arrays, replace entirely (don't merge)
      result[key] = sourceValue
    } else {
      result[key] = sourceValue
    }
  }

  return result
}

// ============================================================================
// V1 TO V2 MIGRATION
// ============================================================================

/**
 * Migrate v1.0 config to v2.0 format
 */
function migrateV1ToV2(config: AstridConfig): AstridConfig {
  if (config.version === '2.0') {
    return config
  }

  // v1.0 configs are already compatible - just mark as 2.0
  // The merge with defaults will fill in missing sections
  return {
    ...config,
    version: '2.0',
  }
}

// ============================================================================
// CONFIG LOADING
// ============================================================================

/**
 * Load and resolve config from repository
 *
 * @param repoPath - Path to the repository root
 * @returns Fully resolved config with all defaults applied
 */
export async function loadAstridConfig(repoPath: string): Promise<ResolvedAstridConfig> {
  // Check cache first
  const cached = configCache.get(repoPath)
  if (cached) {
    return cached
  }

  const configPath = path.join(repoPath, '.astrid.config.json')
  let userConfig: Partial<AstridConfig> = {}

  try {
    const content = await fs.readFile(configPath, 'utf-8')
    userConfig = JSON.parse(content) as AstridConfig

    // Migrate v1 to v2 if needed
    if (userConfig.version && userConfig.version !== '2.0') {
      userConfig = migrateV1ToV2(userConfig as AstridConfig)
    }
  } catch {
    // No config file or invalid JSON - use defaults
    log.info('   ℹ️ No .astrid.config.json found, using defaults')
  }

  // Deep merge user config with defaults
  const resolved = deepMerge(
    CONFIG_DEFAULTS as unknown as Record<string, unknown>,
    userConfig as unknown as Record<string, unknown>
  ) as unknown as ResolvedAstridConfig

  // Ensure arrays from user config override defaults completely (not merged)
  if (userConfig.protectedPaths) {
    resolved.protectedPaths = userConfig.protectedPaths
  }
  if (userConfig.prompts?.planningRules) {
    resolved.prompts.planningRules = userConfig.prompts.planningRules
  }
  if (userConfig.prompts?.executionRules) {
    resolved.prompts.executionRules = userConfig.prompts.executionRules
  }
  if (userConfig.tools?.blockedCommands) {
    resolved.tools.blockedCommands = userConfig.tools.blockedCommands
  }
  if (userConfig.safety?.blockedBashPatterns) {
    resolved.safety.blockedBashPatterns = userConfig.safety.blockedBashPatterns
  }

  // Cache the result
  configCache.set(repoPath, resolved)

  return resolved
}

// ============================================================================
// PLATFORM DETECTION
// ============================================================================

/**
 * Detect platform from task context using config rules
 */
export function detectPlatform(
  config: ResolvedAstridConfig,
  taskTitle: string,
  taskDescription: string
): PlatformDetection | null {
  const searchText = `${taskTitle} ${taskDescription}`.toLowerCase()

  // Check configured platforms
  if (config.platforms && config.platforms.length > 0) {
    for (const platform of config.platforms) {
      const hasKeyword = platform.keywords.some(kw =>
        searchText.includes(kw.toLowerCase())
      )
      if (hasKeyword) {
        return platform
      }
    }
  }

  // Fallback: check structure keys for platform hints
  if (config.structure) {
    for (const [key, structure] of Object.entries(config.structure)) {
      const keyLower = key.toLowerCase()
      if (searchText.includes(keyLower)) {
        return {
          name: structure.name || key,
          keywords: [keyLower],
          filePatterns: structure.filePatterns,
          hints: structure.conventions,
        }
      }
    }
  }

  return null
}

// ============================================================================
// PROMPT HELPERS
// ============================================================================

/**
 * Generate structure prompt from config
 */
export function generateStructurePrompt(config: ResolvedAstridConfig): string {
  if (!config.structure || Object.keys(config.structure).length === 0) {
    return ''
  }

  const lines = ['## Project Structure\n']

  for (const [key, structure] of Object.entries(config.structure)) {
    lines.push(`### ${structure.name || key}`)
    if (structure.description) {
      lines.push(structure.description)
    }
    lines.push(`- Root: \`${structure.rootPath}\``)
    lines.push(`- Patterns: ${structure.filePatterns.map(p => `\`${p}\``).join(', ')}`)
    if (structure.keyDirectories?.length) {
      lines.push(`- Key directories: ${structure.keyDirectories.join(', ')}`)
    }
    if (structure.conventions?.length) {
      lines.push(`- Conventions:`)
      structure.conventions.forEach(c => lines.push(`  - ${c}`))
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Generate platform-specific hints
 */
export function generatePlatformHints(platform: PlatformDetection | null): string {
  if (!platform) {
    return ''
  }

  const lines = [`## Platform: ${platform.name}\n`]

  if (platform.filePatterns?.length) {
    lines.push(`File patterns to explore: ${platform.filePatterns.map(p => `\`${p}\``).join(', ')}`)
  }

  if (platform.hints?.length) {
    lines.push('\n**Platform-specific guidance:**')
    platform.hints.forEach(h => lines.push(`- ${h}`))
  }

  return lines.join('\n')
}

/**
 * Get initial glob pattern for exploration
 */
export function getInitialGlobPattern(
  config: ResolvedAstridConfig,
  platform: PlatformDetection | null
): string {
  // Use platform pattern if detected
  if (platform?.filePatterns?.length) {
    return platform.filePatterns[0]
  }

  // Use first structure pattern
  if (config.structure) {
    const firstStructure = Object.values(config.structure)[0]
    if (firstStructure?.filePatterns?.length) {
      return firstStructure.filePatterns[0]
    }
  }

  // Default to TypeScript files
  return '**/*.ts'
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Check if a path matches any protected patterns
 */
export function isProtectedPath(filePath: string, config: ResolvedAstridConfig): boolean {
  const { protectedPaths } = config

  for (const pattern of protectedPaths) {
    // Simple glob matching
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$'
      )
      if (regex.test(filePath)) {
        return true
      }
    } else if (filePath === pattern || filePath.endsWith(`/${pattern}`)) {
      return true
    }
  }

  return false
}

/**
 * Check if a bash command matches blocked patterns
 */
export function isBlockedCommand(command: string, config: ResolvedAstridConfig): boolean {
  const { blockedBashPatterns } = config.safety
  const { blockedCommands, allowedCommands } = config.tools

  // Check if explicitly allowed
  if (allowedCommands?.some(allowed => command.includes(allowed))) {
    return false
  }

  // Check blocked patterns from both safety and tools config
  const allBlocked = [...blockedBashPatterns, ...blockedCommands]
  return allBlocked.some(blocked => command.includes(blocked))
}
