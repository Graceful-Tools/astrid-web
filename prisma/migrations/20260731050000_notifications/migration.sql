-- Task ab0572cb: in-app notifications.
--
-- Notifications were due-date only — nothing fired on assignment, @-mention,
-- reply or completion, even though the mention syntax already parsed. Rows are
-- derived from TaskEvent fan-out, never written independently.

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "taskId" TEXT,
    "commentId" TEXT,
    "actorId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- The unread-count query, which runs on every page load for anyone with a bell.
CREATE INDEX "Notification_userId_readAt_createdAt_idx"
    ON "Notification"("userId", "readAt", "createdAt");
CREATE INDEX "Notification_taskId_idx" ON "Notification"("taskId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deleting a task clears its notifications: a link to a task that no longer
-- exists is worse than no notification at all.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
