-- CreateTable
CREATE TABLE "CopilotCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "githubLogin" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CopilotCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CopilotCredential_userId_key" ON "CopilotCredential"("userId");

-- CreateIndex
CREATE INDEX "CopilotCredential_userId_idx" ON "CopilotCredential"("userId");

-- AddForeignKey
ALTER TABLE "CopilotCredential" ADD CONSTRAINT "CopilotCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
