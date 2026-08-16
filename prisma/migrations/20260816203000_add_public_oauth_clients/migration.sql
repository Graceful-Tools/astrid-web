ALTER TABLE "OAuthClient"
  ALTER COLUMN "clientSecret" DROP NOT NULL,
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'client_secret_post';

ALTER TABLE "OAuthAuthorizationCode"
  ADD COLUMN "codeChallenge" TEXT,
  ADD COLUMN "codeChallengeMethod" TEXT;
