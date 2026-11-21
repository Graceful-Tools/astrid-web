// The Whitelabel Partner brand (brands/whitelabel-partner.brand.json) on Azure
// (AWTD-1468). Copy this file per brand: <brand>.bicepparam.
//
//   az deployment group create -g <rg> -f deploy/azure/main.bicep -p deploy/azure/whitelabel-partner.bicepparam
//
// Secrets are read from YOUR shell environment when the file is compiled, so
// none is ever written here. Keep them in your own secret store and export them
// for every deployment: the same values each time. Two are irreplaceable:
// ENCRYPTION_KEY (stored credentials are unreadable without it) and
// POSTGRES_ADMIN_PASSWORD (the database's). docs/deployment/AZURE.md, "Secrets".
using 'main.bicep'

param name = 'wlp'

// This template builds the brand in: set APP_IMAGE to an image built with
// --build-arg BRAND=whitelabel-partner and pushed to your registry (AZURE.md,
// "Images"). It does not yet mount a profile at runtime (BRAND_PROFILE), so the
// published default below serves the default brand. Its tag tracks the release.
param appImage = readEnvironmentVariable('APP_IMAGE', 'ghcr.io/graceful-tools/astrid-web:1.4.0')
param migratorImage = readEnvironmentVariable('MIGRATOR_IMAGE', 'ghcr.io/graceful-tools/astrid-web:1.4.0-migrator')
param registryServer = readEnvironmentVariable('REGISTRY_SERVER', '')
param registryUsername = readEnvironmentVariable('REGISTRY_USERNAME', '')
param registryPassword = readEnvironmentVariable('REGISTRY_PASSWORD', '')

// Empty until the custom-domain steps in AZURE.md; then the domain, and later
// bindManagedCertificate = true.
param customDomain = readEnvironmentVariable('CUSTOM_DOMAIN', '')
param bindManagedCertificate = bool(readEnvironmentVariable('BIND_MANAGED_CERTIFICATE', 'false'))

// 1 with clients reaching Container Apps directly; 2 behind Front Door.
param trustedProxyDepth = int(readEnvironmentVariable('TRUSTED_PROXY_DEPTH', '1'))

param nextauthSecret = readEnvironmentVariable('NEXTAUTH_SECRET')
param encryptionKey = readEnvironmentVariable('ENCRYPTION_KEY')
param cronSecret = readEnvironmentVariable('CRON_SECRET')
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
// After a point-in-time restore: the restored server's name.
param postgresServerName = readEnvironmentVariable('POSTGRES_SERVER_NAME', '')

// Optional secrets. An empty one is skipped.
param optionalSecrets = {
  SMTP_URL: readEnvironmentVariable('SMTP_URL', '')
  VAPID_PRIVATE_KEY: readEnvironmentVariable('VAPID_PRIVATE_KEY', '')
  AUTH_SSO_CLIENT_SECRET: readEnvironmentVariable('AUTH_SSO_CLIENT_SECRET', '')
  OPENAI_API_KEY: readEnvironmentVariable('OPENAI_API_KEY', '')
}

// Plain runtime settings. Brand values (NEXT_PUBLIC_BRAND_*, which sign-in
// providers exist) belong in the brand profile, not here.
param appSettings = {
  // Empty: noreply@<the brand's domain>. Or 'Tasks <noreply@tasks.partner.example>'.
  FROM_EMAIL: readEnvironmentVariable('FROM_EMAIL', '')
  // 'log' writes mail to the log instead of sending it, so a first deployment
  // starts without a relay. Export EMAIL_TRANSPORT=smtp with SMTP_URL before
  // real users arrive: smtp without SMTP_URL refuses to boot (AZURE.md, "Deploy").
  EMAIL_TRANSPORT: readEnvironmentVariable('EMAIL_TRANSPORT', 'log')
  // Server-only, so it has to be set here; the environment beats the brand profile,
  // so keep it equal to BRAND_ENABLED_AGENTS in brands/whitelabel-partner.brand.json.
  BRAND_ENABLED_AGENTS: 'claude,copilot'
  // Entra ID as the sso provider (AZURE.md, "Sign-in with Entra ID"). Takes
  // effect only in an image whose brand lists sso in NEXT_PUBLIC_BRAND_AUTH_PROVIDERS.
  AUTH_SSO_ISSUER: readEnvironmentVariable('AUTH_SSO_ISSUER', '')
  AUTH_SSO_CLIENT_ID: readEnvironmentVariable('AUTH_SSO_CLIENT_ID', '')
  AUTH_SSO_DOMAINS: readEnvironmentVariable('AUTH_SSO_DOMAINS', '')
  AUTH_SSO_LABEL: 'Sign in with Microsoft'
  VAPID_PUBLIC_KEY: readEnvironmentVariable('VAPID_PUBLIC_KEY', '')
  // mailto: your support address, e.g. 'mailto:support@tasks.partner.example'.
  VAPID_SUBJECT: readEnvironmentVariable('VAPID_SUBJECT', '')
}

param tags = {
  brand: 'whitelabel-partner'
  app: 'astrid'
}
