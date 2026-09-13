/**
 * Tests for Astrid Configuration Loader
 *
 * These tests verify the config loading and helper functions work correctly
 * without making any API calls (no token usage).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import {
  loadAstridConfig,
  clearConfigCache,
  detectPlatform,
  generateStructurePrompt,
  generatePlatformHints,
  getInitialGlobPattern,
} from '../../lib/ai/config'
import { CONFIG_DEFAULTS as DEFAULT_CONFIG } from '../../lib/ai/config/defaults'
import type { AstridConfig, ResolvedAstridConfig } from '../../lib/ai/config/schema'

describe('Astrid Config Loader', () => {
  beforeEach(() => {
    clearConfigCache()
  })

  describe('loadAstridConfig', () => {
    // Note: ESM module mocking limitations prevent testing fs.readFile mocks directly
    // The integration tests below verify the real file loading works

    it('should return default config when loading from non-existent path', async () => {
      const config = await loadAstridConfig('/this/path/does/not/exist')

      // Default config is now v2.0
      expect(config.version).toBe('2.0')
      expect(config.agent?.planningTimeoutMinutes).toBe(10)
      expect(config.agent?.executionTimeoutMinutes).toBe(15)
    })

    it('should cache config for same repo path', async () => {
      // First load with real path
      const config1 = await loadAstridConfig(process.cwd())
      const config2 = await loadAstridConfig(process.cwd())

      // Same reference means caching is working
      expect(config1).toBe(config2)
    })

    it('should have correct default config values', () => {
      // Default config is now v2.0
      expect(DEFAULT_CONFIG.version).toBe('2.0')
      expect(DEFAULT_CONFIG.agent?.planningTimeoutMinutes).toBe(10)
      expect(DEFAULT_CONFIG.agent?.executionTimeoutMinutes).toBe(15)
      expect(DEFAULT_CONFIG.agent?.maxPlanningIterations).toBe(30)
      expect(DEFAULT_CONFIG.agent?.maxExecutionIterations).toBe(50)
    })
  })

  describe('detectPlatform', () => {
    // detectPlatform takes a RESOLVED config, so build on CONFIG_DEFAULTS
    // rather than a bare AstridConfig, which is missing every required
    // sub-config. (AWTD-916)
    const configWithPlatforms: ResolvedAstridConfig = {
      ...DEFAULT_CONFIG,
      version: '1.0',
      platforms: [
        {
          name: 'ios',
          keywords: ['ios', 'swift', 'xcode', 'iphone'],
          filePatterns: ['ios-app/**/*.swift'],
          hints: ['iOS files are in ios-app/']
        },
        {
          name: 'android',
          keywords: ['android', 'kotlin', 'gradle'],
          filePatterns: ['android/**/*.kt'],
          hints: ['Android files are in android/']
        },
        {
          name: 'web',
          keywords: ['web', 'react', 'frontend'],
          filePatterns: ['**/*.tsx'],
          hints: []
        }
      ]
    }

    it('should detect iOS platform from title', () => {
      const platform = detectPlatform(configWithPlatforms, 'iOS: Fix bug in settings', '')

      expect(platform).not.toBeNull()
      expect(platform?.name).toBe('ios')
    })

    it('should detect iOS platform from description', () => {
      const platform = detectPlatform(configWithPlatforms, 'Fix bug', 'This affects the Swift code')

      expect(platform).not.toBeNull()
      expect(platform?.name).toBe('ios')
    })

    it('should detect Android platform', () => {
      const platform = detectPlatform(configWithPlatforms, 'Android: Add feature', '')

      expect(platform).not.toBeNull()
      expect(platform?.name).toBe('android')
    })

    it('should detect web platform', () => {
      const platform = detectPlatform(configWithPlatforms, 'Update React component', '')

      expect(platform).not.toBeNull()
      expect(platform?.name).toBe('web')
    })

    it('should return null when no platform matches', () => {
      const platform = detectPlatform(configWithPlatforms, 'Update documentation', '')

      expect(platform).toBeNull()
    })

    it('should return null when config has no platforms', () => {
      const platform = detectPlatform({ ...DEFAULT_CONFIG, version: '1.0' }, 'iOS task', '')

      expect(platform).toBeNull()
    })

    it('should be case-insensitive', () => {
      const platform = detectPlatform(configWithPlatforms, 'IOS: SWIFT CODE', '')

      expect(platform).not.toBeNull()
      expect(platform?.name).toBe('ios')
    })
  })

  describe('generateStructurePrompt', () => {
    it('should return empty string when no structure defined', () => {
      const prompt = generateStructurePrompt({ ...DEFAULT_CONFIG, version: '1.0' })

      expect(prompt).toBe('')
    })

    it('should generate prompt from structure', () => {
      const config: AstridConfig = {
        version: '2.0',
        structure: {
          web: {
            name: 'Web App',
            description: 'Next.js web app',
            rootPath: '.',
            filePatterns: ['**/*.ts'],
            keyDirectories: ['app/', 'components/']
          },
          ios: {
            name: 'iOS App',
            description: 'iOS Swift app',
            rootPath: 'ios-app/',
            filePatterns: ['**/*.swift'],
          }
        }
      }

      const prompt = generateStructurePrompt(config as any)

      expect(prompt).toContain('## Project Structure')
      expect(prompt).toContain('### Web App')
      expect(prompt).toContain('Next.js web app')
      expect(prompt).toContain('Root: `.`')
      expect(prompt).toContain('app/, components/')
      expect(prompt).toContain('### iOS App')
      expect(prompt).toContain('iOS Swift app')
      expect(prompt).toContain('Root: `ios-app/`')
    })
  })

  describe('generatePlatformHints', () => {
    it('should return empty string for null platform', () => {
      const hints = generatePlatformHints(null)

      expect(hints).toBe('')
    })

    it('should generate hints from platform', () => {
      const platform = {
        name: 'ios',
        keywords: ['ios'],
        filePatterns: ['ios-app/**/*.swift', 'ios-app/**/*.xib'],
        hints: ['Use SwiftUI patterns', 'Check Xcode project settings']
      }

      const hints = generatePlatformHints(platform)

      // New format uses "## Platform: name"
      expect(hints).toContain('## Platform: ios')
      expect(hints).toContain('ios-app/**/*.swift')
      expect(hints).toContain('ios-app/**/*.xib')
      expect(hints).toContain('Use SwiftUI patterns')
      expect(hints).toContain('Check Xcode project settings')
    })

    it('should work without hints array', () => {
      const platform = {
        name: 'web',
        keywords: ['web'],
        filePatterns: ['**/*.tsx'],
      }

      const hints = generatePlatformHints(platform)

      // New format uses "## Platform: name"
      expect(hints).toContain('## Platform: web')
      expect(hints).toContain('**/*.tsx')
    })
  })

  describe('getInitialGlobPattern', () => {
    it('should return platform file pattern when platform detected', () => {
      const platform = {
        name: 'ios',
        keywords: ['ios'],
        filePatterns: ['ios-app/**/*.swift'],
      }

      const pattern = getInitialGlobPattern({ ...DEFAULT_CONFIG, version: '1.0' }, platform)

      expect(pattern).toBe('ios-app/**/*.swift')
    })

    it('should return default TypeScript pattern when no platform', () => {
      const pattern = getInitialGlobPattern({ ...DEFAULT_CONFIG, version: '1.0' }, null)

      expect(pattern).toBe('**/*.ts')
    })

    it('should return default when platform has empty filePatterns', () => {
      const platform = {
        name: 'test',
        keywords: ['test'],
        filePatterns: [],
      }

      const pattern = getInitialGlobPattern({ ...DEFAULT_CONFIG, version: '1.0' }, platform)

      expect(pattern).toBe('**/*.ts')
    })
  })
})

describe('Config Integration', () => {
  // These tests use the actual config file in the repo

  it('should load the actual .astrid.config.json from this repo', async () => {
    clearConfigCache()

    const repoPath = process.cwd()
    const configPath = path.join(repoPath, '.astrid.config.json')

    // Check if config exists
    try {
      await fs.access(configPath)
    } catch {
      // Skip test if no config file
      console.log('Skipping: No .astrid.config.json in repo')
      return
    }

    const config = await loadAstridConfig(repoPath)

    // Config is auto-migrated to v2.0
    expect(config.version).toBe('2.0')
    expect(config.projectName).toBe('Astrid')
    expect(config.structure).toBeDefined()
    expect(config.platforms).toBeDefined()
  })

  it('should detect iOS platform for iOS tasks in this repo', async () => {
    clearConfigCache()

    const repoPath = process.cwd()

    try {
      await fs.access(path.join(repoPath, '.astrid.config.json'))
    } catch {
      console.log('Skipping: No .astrid.config.json in repo')
      return
    }

    const config = await loadAstridConfig(repoPath)
    // Test web platform detection (iOS is now in separate repo)
    const platform = detectPlatform(config, 'Fix React component rendering', '')

    expect(platform).not.toBeNull()
    expect(platform?.name).toBe('web')
    expect(platform?.filePatterns).toContain('**/*.tsx')
  })
})
