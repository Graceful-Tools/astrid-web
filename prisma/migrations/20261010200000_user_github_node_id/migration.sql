-- AWTD-1116 P5c: the user's GitHub node id, so GitHub-backed tasks can be
-- assigned to them. Additive and nullable; no existing row changes.
ALTER TABLE "User" ADD COLUMN "githubNodeId" TEXT;
CREATE UNIQUE INDEX "User_githubNodeId_key" ON "User"("githubNodeId");
