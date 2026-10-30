import { createScriptPrisma } from "./lib/script-prisma"
import { checkDatabaseSafety } from "./db-safety-check"

const prisma = createScriptPrisma()

async function main() {
  console.log("🌱 Seeding database...")

  // Safety check - this will DELETE ALL DATA
  checkDatabaseSafety('DATABASE SEED (DESTRUCTIVE)')

  // Clean up existing data
  console.log("🧹 Cleaning up existing data...")
  await prisma.comment.deleteMany()
  await prisma.task.deleteMany()
  await prisma.taskList.deleteMany()
  await prisma.user.deleteMany()

  // Create a demo user
  const demoUser = await prisma.user.create({
    data: {
      email: "demo@astrid.cc",
      name: "Demo User",
      image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=32&h=32&fit=crop&crop=face",
    },
  })

  // Create demo task lists
  const personalList = await prisma.taskList.create({
    data: {
      name: "Personal Tasks",
      description: "My personal todo list",
      color: "#3b82f6",
      privacy: "PRIVATE",
      ownerId: demoUser.id,
    },
  })

  const workList = await prisma.taskList.create({
    data: {
      name: "Work Projects",
      description: "Professional tasks and projects",
      color: "#10b981",
      privacy: "SHARED",
      ownerId: demoUser.id,
      defaultPriority: 1,
      defaultIsPrivate: false,
    },
  })

  const publicList = await prisma.taskList.create({
    data: {
      name: "Public Recipes",
      description: "Cooking recipes and tips",
      color: "#f59e0b",
      privacy: "PUBLIC",
      ownerId: demoUser.id,
    },
  })

  // Create demo tasks with list connections
  const task1 = await prisma.task.create({
    data: {
      title: "Welcome to Astrid!",
      description: "This is your first task. Click to edit or mark as complete.",
      priority: 2,
      assigneeId: demoUser.id,
      creatorId: demoUser.id,
      dueDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      isAllDay: false,
      lists: {
        connect: [{ id: personalList.id }],
      },
    },
  })

  const task2 = await prisma.task.create({
    data: {
      title: "Set up your workspace",
      description: "Customize your lists and preferences",
      priority: 1,
      assigneeId: demoUser.id,
      creatorId: demoUser.id,
      lists: {
        connect: [{ id: personalList.id }],
      },
    },
  })

  const task3 = await prisma.task.create({
    data: {
      title: "Invite team members",
      description: "Add colleagues to shared lists",
      priority: 0,
      assigneeId: demoUser.id,
      creatorId: demoUser.id,
      isPrivate: false,
      lists: {
        connect: [{ id: workList.id }],
      },
    },
  })

  const task4 = await prisma.task.create({
    data: {
      title: "Perfect Chocolate Chip Cookies",
      description: "A family recipe for the best chocolate chip cookies",
      priority: 1,
      assigneeId: demoUser.id,
      creatorId: demoUser.id,
      isPrivate: false,
      lists: {
        connect: [{ id: publicList.id }],
      },
    },
  })

  // Create some comments
  await prisma.comment.create({
    data: {
      content: "Welcome to Astrid! This is a sample comment.",
      type: "TEXT",
      authorId: demoUser.id,
      taskId: task1.id,
    },
  })

  console.log("✅ Database seeded successfully!")
  console.log(`📊 Created:`)
  console.log(`   • 1 user: ${demoUser.email}`)
  console.log(`   • 3 lists: Personal, Work, Public`)
  console.log(`   • 4 tasks with various priorities`)
  console.log(`   • 1 comment`)
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
