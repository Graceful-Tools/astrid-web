-- CreateTable
CREATE TABLE "openclaw_workers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gatewayUrl" TEXT NOT NULL,
    "authToken" TEXT,
    "authMode" TEXT NOT NULL DEFAULT 'token',
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastSeen" TIMESTAMP(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "openclaw_workers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "openclaw_workers_userId_idx" ON "openclaw_workers"("userId");

-- CreateIndex
CREATE INDEX "openclaw_workers_isActive_idx" ON "openclaw_workers"("isActive");

-- CreateIndex
CREATE INDEX "openclaw_workers_status_idx" ON "openclaw_workers"("status");

-- CreateIndex
CREATE INDEX "openclaw_workers_userId_isActive_idx" ON "openclaw_workers"("userId", "isActive");

-- AddForeignKey
ALTER TABLE "openclaw_workers" ADD CONSTRAINT "openclaw_workers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
