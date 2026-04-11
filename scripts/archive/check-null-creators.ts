import { prisma } from '../lib/prisma'

async function checkNullCreators() {
  try {
    const tasksWithNullCreator = await prisma.task.findMany({
      where: { creatorId: null },
      take: 10,
      select: {
        id: true,
        title: true,
        creatorId: true,
        assigneeId: true,
        lists: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    console.log(`\n📊 Tasks with NULL creatorId: ${tasksWithNullCreator.length}`)
    console.log(JSON.stringify(tasksWithNullCreator, null, 2))

    const commentsWithNullAuthor = await prisma.comment.findMany({
      where: { authorId: null },
      take: 10,
      select: {
        id: true,
        content: true,
        authorId: true,
        task: {
          select: {
            id: true,
            title: true
          }
        }
      }
    })

    console.log(`\n💬 Comments with NULL authorId: ${commentsWithNullAuthor.length}`)
    console.log(JSON.stringify(commentsWithNullAuthor, null, 2))

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkNullCreators()
