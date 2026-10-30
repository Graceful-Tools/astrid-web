#!/usr/bin/env tsx
/**
 * Database Backup Script
 * Creates a backup of the current database
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set')
  process.exit(1)
}

// Create backups directory if it doesn't exist
const backupsDir = path.join(process.cwd(), 'backups')
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true })
}

// Generate backup filename with timestamp
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
const dbName = DATABASE_URL.includes('astrid_dev') ? 'dev' : 'prod'
const backupFile = path.join(backupsDir, `backup-${dbName}-${timestamp}.sql`)

console.log('📦 Creating database backup...')
console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`)
console.log(`Backup file: ${backupFile}`)

try {
  // Use pg_dump to create the backup
  execSync(`pg_dump "${DATABASE_URL}" > "${backupFile}"`)

  // Check file size
  const stats = fs.statSync(backupFile)
  const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2)

  console.log(`✅ Backup created successfully (${fileSizeInMB} MB)`)
  console.log(`📁 Location: ${backupFile}`)

  // List recent backups
  const files = fs.readdirSync(backupsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .reverse()
    .slice(0, 5)

  console.log('\n📚 Recent backups:')
  files.forEach(file => {
    const filePath = path.join(backupsDir, file)
    const stats = fs.statSync(filePath)
    const size = (stats.size / (1024 * 1024)).toFixed(2)
    console.log(`  - ${file} (${size} MB)`)
  })

} catch (error) {
  console.error('❌ Backup failed:', error)

  // Try alternative method using Prisma export
  console.log('\n🔄 Trying alternative backup method...')

  async function createJsonBackup() {
    try {
      const tables = ['User', 'TaskList', 'Task', 'Comment', 'Attachment']
      const backupData: any = {}

      const { createScriptPrisma } = require('./lib/script-prisma')
      const prisma = createScriptPrisma()

      for (const table of tables) {
        const data = await (prisma as any)[table.toLowerCase()].findMany()
        backupData[table] = data
        console.log(`  - Exported ${data.length} ${table} records`)
      }

      const jsonBackup = backupFile.replace('.sql', '.json')
      fs.writeFileSync(jsonBackup, JSON.stringify(backupData, null, 2))

      const stats = fs.statSync(jsonBackup)
      const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2)

      console.log(`✅ JSON backup created (${fileSizeInMB} MB)`)
      console.log(`📁 Location: ${jsonBackup}`)

      await prisma.$disconnect()
    } catch (jsonError) {
      console.error('❌ JSON backup also failed:', jsonError)
      process.exit(1)
    }
  }

  createJsonBackup()
}