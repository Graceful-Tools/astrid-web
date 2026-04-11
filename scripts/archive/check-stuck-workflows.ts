import dotenv from 'dotenv'
import path from 'path'
import { PrismaClient } from '@prisma/client'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const prisma = new PrismaClient()

async function check() {
  const taskIds = [
    'eef79e1e-a12b-46db-89e1-0532c833fc28',
    'b27d818b-ac18-4c7c-9517-bb3842eff65a',
    '280fab0e-6a87-43cb-9a98-08ae64656f1a'
  ]

  console.log('Checking workflows for stuck tasks...\n')

  for (const taskId of taskIds) {
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { taskId }
    })

    const shortId = taskId.substring(0, 8)

    if (workflow) {
      console.log('Task ' + shortId + '...')
      console.log('  Status: ' + workflow.status)
      console.log('  Updated: ' + workflow.updatedAt)
      console.log()
    } else {
      console.log('Task ' + shortId + '... NO WORKFLOW RECORD')
      console.log()
    }
  }

  await prisma.$disconnect()
}

check().catch(e => {
  console.error(e)
  process.exit(1)
})
