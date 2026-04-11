/**
 * Comprehensive MCP API Audit
 *
 * Compares:
 * 1. Backend MCP operations (server)
 * 2. iOS MCP client methods
 * 3. Prisma schema fields vs iOS model fields
 * 4. Identifies gaps and missing functionality
 */

import * as fs from 'fs'
import * as path from 'path'

console.log('🔍 MCP API COMPREHENSIVE AUDIT')
console.log('='.repeat(80))
console.log('')

// ==================== PART 1: Backend API Operations ====================
console.log('📡 PART 1: Backend MCP API Operations')
console.log('-'.repeat(80))

const backendFile = fs.readFileSync('app/api/mcp/operations/route.ts', 'utf-8')

// Extract all async function definitions
const backendFunctions = backendFile.match(/async function \w+\(/g) || []
const backendOps = backendFunctions.map(f => f.replace('async function ', '').replace('(', ''))

console.log('Backend Operations Found:', backendOps.length)
backendOps.forEach(op => console.log('  ✓', op))
console.log('')

// Extract operation switch cases
const operationMatches = backendFile.match(/case '([^']+)':/g) || []
const exposedOps = operationMatches.map(m => m.replace("case '", "").replace("':", ""))

console.log('Exposed MCP Operations (switch cases):', exposedOps.length)
exposedOps.forEach(op => console.log('  ✓', op))
console.log('')

// ==================== PART 2: iOS Client Methods ====================
console.log('📱 PART 2: iOS MCP Client Methods')
console.log('-'.repeat(80))

const iosClientFile = fs.readFileSync('ios-app/Astrid App/Core/Networking/MCPClient.swift', 'utf-8')

// Extract public func definitions
const iosFunctions = iosClientFile.match(/    func \w+\(/g) || []
const iosClientMethods = iosFunctions
  .map(f => f.trim().replace('func ', '').replace('(', ''))
  .filter(name => !name.startsWith('private'))

console.log('iOS Client Methods Found:', iosClientMethods.length)
iosClientMethods.forEach(method => console.log('  ✓', method))
console.log('')

// ==================== PART 3: Schema Comparison ====================
console.log('🗄️  PART 3: Database Schema Comparison')
console.log('-'.repeat(80))

// Extract Prisma TaskList fields
const prismaSchema = fs.readFileSync('prisma/schema.prisma', 'utf-8')
const taskListMatch = prismaSchema.match(/model TaskList \{[\s\S]*?\n\}/m)
const taskListSchema = taskListMatch ? taskListMatch[0] : ''
const prismaTaskListFields = (taskListSchema.match(/^\s+(\w+)\s+/gm) || [])
  .map(f => f.trim().split(/\s+/)[0])
  .filter(f => f && f !== 'id')

console.log('Prisma TaskList Fields:', prismaTaskListFields.length)
prismaTaskListFields.forEach(field => console.log('  ✓', field))
console.log('')

// Extract iOS TaskList fields
const iosTaskListFile = fs.readFileSync('ios-app/Astrid App/Models/TaskList.swift', 'utf-8')
const iosTaskListFields = (iosTaskListFile.match(/^\s+(let|var)\s+(\w+):/gm) || [])
  .map(f => f.trim().split(/\s+/)[1])

console.log('iOS TaskList Fields:', iosTaskListFields.length)
iosTaskListFields.forEach(field => console.log('  ✓', field))
console.log('')

// Extract Prisma Task fields
const taskMatch = prismaSchema.match(/model Task \{[\s\S]*?\n\}/m)
const taskSchema = taskMatch ? taskMatch[0] : ''
const prismaTaskFields = (taskSchema.match(/^\s+(\w+)\s+/gm) || [])
  .map(f => f.trim().split(/\s+/)[0])
  .filter(f => f && f !== 'id')

console.log('Prisma Task Fields:', prismaTaskFields.length)
prismaTaskFields.forEach(field => console.log('  ✓', field))
console.log('')

// Extract iOS Task fields
const iosTaskFile = fs.readFileSync('ios-app/Astrid App/Models/Task.swift', 'utf-8')
const iosTaskFields = (iosTaskFile.match(/^\s+(let|var)\s+(\w+):/gm) || [])
  .map(f => f.trim().split(/\s+/)[1])

console.log('iOS Task Fields:', iosTaskFields.length)
iosTaskFields.forEach(field => console.log('  ✓', field))
console.log('')

// ==================== PART 4: Gap Analysis ====================
console.log('')
console.log('🔴 PART 4: GAP ANALYSIS')
console.log('='.repeat(80))
console.log('')

// Check for backend operations missing in iOS client
console.log('❌ Backend Operations NOT in iOS Client:')
const missingInIOS = exposedOps.filter(op => {
  const iosMethod = op.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  return !iosClientMethods.some(m => m.toLowerCase().includes(iosMethod.toLowerCase()))
})
if (missingInIOS.length === 0) {
  console.log('  ✅ All backend operations have iOS client methods!')
} else {
  missingInIOS.forEach(op => console.log('  ❌', op))
}
console.log('')

// Check for Prisma TaskList fields missing in iOS
console.log('❌ Prisma TaskList Fields NOT in iOS Model:')
const missingTaskListFields = prismaTaskListFields.filter(f => !iosTaskListFields.includes(f))
if (missingTaskListFields.length === 0) {
  console.log('  ✅ All Prisma TaskList fields exist in iOS!')
} else {
  missingTaskListFields.forEach(field => console.log('  ❌', field))
}
console.log('')

// Check for Prisma Task fields missing in iOS
console.log('❌ Prisma Task Fields NOT in iOS Model:')
const missingTaskFields = prismaTaskFields.filter(f => !iosTaskFields.includes(f))
if (missingTaskFields.length === 0) {
  console.log('  ✅ All Prisma Task fields exist in iOS!')
} else {
  missingTaskFields.forEach(field => console.log('  ❌', field))
}
console.log('')

// ==================== PART 5: API Coverage ====================
console.log('📊 PART 5: API COVERAGE SUMMARY')
console.log('='.repeat(80))
console.log('')

console.log('LIST Operations:')
const listOps = ['create_list', 'get_shared_lists', 'update_list', 'delete_list', 'favorite_list']
listOps.forEach(op => {
  const hasBackend = exposedOps.includes(op)
  const iosMethod = op.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  const hasIOS = iosClientMethods.some(m => m.toLowerCase().includes(iosMethod.toLowerCase()))
  console.log(`  ${hasBackend && hasIOS ? '✅' : '❌'} ${op}: Backend=${hasBackend ? '✓' : '✗'}, iOS=${hasIOS ? '✓' : '✗'}`)
})
console.log('')

console.log('TASK Operations:')
const taskOps = ['create_task', 'get_list_tasks', 'update_task', 'delete_task', 'complete_task']
taskOps.forEach(op => {
  const hasBackend = exposedOps.includes(op)
  const iosMethod = op.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  const hasIOS = iosClientMethods.some(m => m.toLowerCase().includes(iosMethod.toLowerCase()))
  console.log(`  ${hasBackend && hasIOS ? '✅' : '❌'} ${op}: Backend=${hasBackend ? '✓' : '✗'}, iOS=${hasIOS ? '✓' : '✗'}`)
})
console.log('')

console.log('🎯 CRITICAL GAPS TO FIX:')
console.log('  1. Missing backend operations:', missingInIOS.length)
console.log('  2. Missing TaskList fields:', missingTaskListFields.length)
console.log('  3. Missing Task fields:', missingTaskFields.length)
console.log('')
