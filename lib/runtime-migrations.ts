import { prisma } from './prisma'
import { execSync } from 'child_process'
import { createLogger } from '@/lib/logger'

const log = createLogger('runtime-migrations')


let migrationChecked = false
let migrationInProgress = false

/**
 * Ensures database migrations are applied at runtime
 * This is a fallback for when migrations couldn't run during build
 */
export async function ensureMigrations() {
  // Only check once per application instance
  if (migrationChecked || migrationInProgress) return

  migrationInProgress = true

  try {
    // Test if we can connect and basic schema exists
    await prisma.user.count()
    migrationChecked = true
    migrationInProgress = false
    log.info('✅ Database schema verified')
    return { success: true, action: 'verified' }
  } catch (error) {
    log.warn({ error }, '⚠️ Database schema verification failed, attempting to run migrations...')

    // Attempt to run migrations automatically
    try {
      if (process.env.NODE_ENV === 'production' && process.env.AUTO_MIGRATE_ON_STARTUP === 'true') {
        log.info('🔄 Running automatic migrations...')

        // Generate Prisma client first
        execSync('npx prisma generate', { stdio: 'pipe' })
        log.info('✅ Prisma client generated')

        // Deploy migrations
        const migrationOutput = execSync('npx prisma migrate deploy', {
          stdio: 'pipe',
          encoding: 'utf8'
        })
        log.info({ migrationOutput }, '✅ Migrations deployed:')

        // Verify the fix worked
        await prisma.user.count()

        migrationChecked = true
        migrationInProgress = false
        log.info('✅ Database schema fixed and verified')
        return { success: true, action: 'migrated' }

      } else {
        log.info('ℹ️ Auto-migration disabled. Set AUTO_MIGRATE_ON_STARTUP=true to enable.')
        migrationChecked = true
        migrationInProgress = false
        return { success: false, action: 'disabled', error: 'Auto-migration disabled' }
      }
    } catch (migrationError) {
      log.error({ err: migrationError }, '❌ Failed to run automatic migrations:')
      migrationChecked = true
      migrationInProgress = false
      return {
        success: false,
        action: 'failed',
        error: migrationError instanceof Error ? migrationError.message : 'Unknown error'
      }
    }
  }
}

/**
 * Check if migrations need to be applied
 */
export async function checkMigrationStatus() {
  try {
    const output = execSync('npx prisma migrate status', {
      stdio: 'pipe',
      encoding: 'utf8'
    })

    if (output.includes('Database schema is up to date!')) {
      return { needsMigration: false, status: 'up-to-date', output }
    } else {
      return { needsMigration: true, status: 'pending', output }
    }
  } catch (error) {
    return {
      needsMigration: true,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Safe database health check that works even with migration issues
 */
export async function safeHealthCheck() {
  try {
    const start = Date.now()
    await prisma.$queryRaw`SELECT 1 as health`
    const responseTime = Date.now() - start
    return { healthy: true, responseTime, timestamp: new Date() }
  } catch (error) {
    log.error({ err: error }, 'Database health check failed:')
    return { 
      healthy: false, 
      responseTime: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date() 
    }
  }
}