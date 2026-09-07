-- Desktop browser hand-off sign-in: one-time PKCE codes that exchange into a
-- first-party session. Deliberately its own table rather than a reuse of
-- "OAuthAuthorizationCode", which redeems into scoped third-party tokens.
CREATE TABLE "DesktopAuthGrant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesktopAuthGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DesktopAuthGrant_code_key" ON "DesktopAuthGrant"("code");
CREATE INDEX "DesktopAuthGrant_userId_idx" ON "DesktopAuthGrant"("userId");
CREATE INDEX "DesktopAuthGrant_expiresAt_idx" ON "DesktopAuthGrant"("expiresAt");

ALTER TABLE "DesktopAuthGrant" ADD CONSTRAINT "DesktopAuthGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
