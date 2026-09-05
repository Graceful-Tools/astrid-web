ALTER TABLE "TaskList"
ADD COLUMN "agentLifecycleEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "agentLifecycleCursor" TEXT;
