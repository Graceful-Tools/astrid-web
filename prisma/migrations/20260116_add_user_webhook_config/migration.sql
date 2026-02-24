-- CreateTable
CREATE TABLE "user_webhook_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "events" TEXT[] DEFAULT ARRAY['task.assigned', 'comment.created']::TEXT[],
    "lastFiredAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_webhook_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_webhook_configs_userId_key" ON "user_webhook_configs"("userId");

-- CreateIndex
CREATE INDEX "user_webhook_configs_userId_idx" ON "user_webhook_configs"("userId");

-- CreateIndex
CREATE INDEX "user_webhook_configs_enabled_idx" ON "user_webhook_configs"("enabled");

-- AddForeignKey
ALTER TABLE "user_webhook_configs" ADD CONSTRAINT "user_webhook_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
