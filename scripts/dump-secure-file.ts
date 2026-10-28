import { createScriptPrisma } from './lib/script-prisma'
const prisma = createScriptPrisma()
async function main() {
  const f: any = await prisma.secureFile.findUnique({ where: { id: process.argv[2] } })
  console.log(f?.blobUrl ?? 'no blobUrl', '|', f?.originalName)
  await prisma.$disconnect()
}
main()
